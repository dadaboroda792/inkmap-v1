import json
import os
import re
import sys
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
IMAGES_DIR = DATA_DIR / "images"
MEDIA_DIR = DATA_DIR / "media"
STATIC_DIR = BASE_DIR / "static"

sys.path.insert(0, str(BASE_DIR / "tools"))
import md_import_lib as mdlib  # noqa: E402

NAME_RE = re.compile(r'^[^\\/:*?"<>|\x00-\x1f]{1,100}$')
WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
ALLOWED_MEDIA_EXT = {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024
MAX_MEDIA_SIZE = 25 * 1024 * 1024


def sanitize_name(name: str) -> str:
    name = (name or "").strip().rstrip(". ")
    if not name or name.split(".")[0].upper() in WINDOWS_RESERVED or not NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Bad map name")
    return name


def map_path(name: str) -> Path:
    return DATA_DIR / f"{sanitize_name(name)}.json"


DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)


class CreateMapPayload(BaseModel):
    name: str


class RenamePayload(BaseModel):
    newName: str


class MapPayload(BaseModel):
    version: int = 1
    meta: dict = {}
    nodes: list = []
    edges: list = []
    strokes: list = []
    shapes: list = []
    reveal: int = 1


def _atomic_write_json(path: Path, data: dict) -> None:
    """Атомарная запись JSON: tmp в том же каталоге + fsync + os.replace."""
    tmp = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _norm_reveal(v) -> int:
    try:
        r = int(v)
    except (TypeError, ValueError):
        return 1
    return max(1, min(5, r))


app = FastAPI(title="InkMap")


@app.middleware("http")
async def no_cache_static(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/js/") or path in (
        "/static/", "/static/index.html", "/static/map.html", "/static/style.css",
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def root():
    return RedirectResponse("/static/index.html")


@app.get("/api/maps")
def list_maps():
    maps = sorted(p.name[: -len(".json")] for p in DATA_DIR.glob("*.json"))
    return {"maps": maps}


@app.post("/api/maps")
def create_map(payload: CreateMapPayload):
    name = sanitize_name(payload.name)
    path = map_path(name)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="Map already exists")
    empty = {"version": 1, "meta": {}, "nodes": [], "edges": [],
             "strokes": [], "shapes": [], "reveal": 1}
    _atomic_write_json(path, empty)
    return {"ok": True, "name": name}


def _load(name: str) -> dict:
    path = map_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Map not found")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise HTTPException(status_code=500, detail="Map file is corrupted")


@app.get("/api/maps/{name}")
def get_map(name: str):
    return JSONResponse(content=_load(name))


@app.put("/api/maps/{name}")
def save_map(name: str, payload: MapPayload):
    path = map_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Map not found")
    data = {
        "version": payload.version,
        "meta": payload.meta,
        "nodes": payload.nodes,
        "edges": payload.edges,
        "strokes": payload.strokes,
        "shapes": payload.shapes,
        "reveal": _norm_reveal(payload.reveal),
    }
    _atomic_write_json(path, data)
    return {"ok": True}


@app.delete("/api/maps/{name}")
def delete_map(name: str):
    path = map_path(name)
    try:
        path.unlink()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Map not found")
    return {"ok": True}


@app.put("/api/maps/{name}/rename")
def rename_map(name: str, payload: RenamePayload):
    src = map_path(name)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Map not found")
    new_name = sanitize_name(payload.newName)
    dst = DATA_DIR / f"{new_name}.json"
    if dst.exists():
        raise HTTPException(status_code=409, detail="Map already exists")
    src.rename(dst)
    return {"ok": True, "name": new_name}


@app.post("/api/images")
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMG_EXT:
        raise HTTPException(status_code=400, detail="Only png/jpg/jpeg/gif/webp")
    if getattr(file, 'size', None) and file.size > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="File larger than 10 MB")
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="File larger than 10 MB")
    fname = f"{uuid.uuid4().hex}{ext}"
    (IMAGES_DIR / fname).write_bytes(data)
    return {"url": f"/images/{fname}"}


@app.post("/api/media")
async def upload_media(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_MEDIA_EXT:
        raise HTTPException(status_code=400, detail="Only webm/ogg/mp3/wav/m4a/mp4")
    if getattr(file, 'size', None) and file.size > MAX_MEDIA_SIZE:
        raise HTTPException(status_code=400, detail="File larger than 25 MB")
    data = await file.read()
    if len(data) > MAX_MEDIA_SIZE:
        raise HTTPException(status_code=400, detail="File larger than 25 MB")
    fname = f"{uuid.uuid4().hex}{ext}"
    (MEDIA_DIR / fname).write_bytes(data)
    return {"url": f"/media/{fname}"}


app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")


# ── Markdown → InkMap import ──────────────────────────────────────

@app.post("/api/import-md")
async def import_md(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {'.md', '.markdown', '.txt'}:
        raise HTTPException(status_code=400, detail="Только .md / .markdown / .txt файлы")
    if getattr(file, 'size', None) and file.size > 500_000:
        raise HTTPException(status_code=400, detail="Файл слишком большой (>500 КБ)")
    text = (await file.read()).decode('utf-8', errors='replace')
    if len(text) > 500_000:
        raise HTTPException(status_code=400, detail="Файл слишком большой (>500 КБ)")
    root = mdlib.parse_text(text)
    mdlib.make_task_nodes(root)
    if mdlib.count_nodes(root) > mdlib.MAX_NODES:
        raise HTTPException(status_code=400,
                            detail=f"Слишком много нод (>{mdlib.MAX_NODES}) — разбей файл")

    # картинки из заметок — скачиваем/декодируем и сохраняем в проект (data/images)
    warnings = []
    for ref in mdlib.scan_images(root):
        try:
            mdlib.attach_image(ref, IMAGES_DIR)
        except Exception as e:
            if ref.kind == 'local':
                warnings.append(f"{ref.node.title[:30]}: локальный путь «{ref.url[:40]}» "
                                f"недоступен — картинка сохранена текстом в заметке")
            else:
                warnings.append(f"{ref.node.title[:30]}: не удалось сохранить картинку "
                                f"({e}) — оставлена в заметке")

    details = mdlib.split_details(root)
    mdlib.assign_ids(root)
    mdlib.set_collapse(root, 0, True)
    mdlib.layout(root)
    overlaps = mdlib.check_overlaps(root)
    data = mdlib.build_json(root, Path(file.filename or 'map').stem)

    errs = mdlib.validate(data)
    if overlaps:
        errs.append('наслоение нод при раскладке: '
                    + '; '.join(f'{a} ~ {b}' for a, b in overlaps[:3]))
    if errs:
        raise HTTPException(status_code=400, detail='Импорт не прошёл валидацию: '
                            + '; '.join(errs[:5]))
    return {
        'nodes': data['nodes'],
        'edges': data['edges'],
        'count': len(data['nodes']),
        'details': details,
        'warnings': warnings,
    }


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8123)
