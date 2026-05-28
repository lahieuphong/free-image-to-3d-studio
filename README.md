# Free Image to 3D Studio

Source mẫu để build web giống flow Meshy: **upload ảnh → AI tạo mesh/texture → preview 3D → tải GLB**.

Mình chọn **Stable Fast 3D (SF3D)** làm AI chính vì:

- Tạo 3D từ **một ảnh**.
- Xuất **GLB** trực tiếp qua script `run.py`.
- Có UV unwrap, texture, material parameters.
- Mặc định khoảng **6GB VRAM** cho một ảnh.
- Miễn phí theo Stability AI Community License nếu bạn/organization dưới ngưỡng doanh thu 1 triệu USD/năm. Với doanh thu lớn hơn cần enterprise license.

> Lưu ý: repo này **không bundle model weight của SF3D**. Bạn cần tự clone repo chính thức, đồng ý license và đăng nhập Hugging Face để tải weight.

## Kiến trúc

```txt
Next.js frontend
  ├─ Upload ảnh
  ├─ Gọi /api/jobs của Next.js
  ├─ Poll trạng thái job
  └─ Hiển thị GLB bằng <model-viewer>

FastAPI AI worker
  ├─ Nhận ảnh
  ├─ Lưu job vào storage/jobs
  ├─ Provider mock hoặc sf3d
  └─ Trả /api/jobs/{id}/model.glb

Stable Fast 3D
  └─ image → mesh.glb
```

## Chạy nhanh để test UI không cần GPU

Worker mặc định dùng `AI_PROVIDER=mock`, trả sample GLB để bạn test web trước.

### 1. Chạy AI worker

```bash
cd ai-worker
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Test worker:

```bash
curl http://localhost:8000/api/health
```

### 2. Chạy frontend Next.js bằng Yarn

Ở terminal khác:

```bash
yarn install
cp .env.local.example .env.local
yarn dev
```

Mở:

```txt
http://localhost:3000
```

## Chạy AI thật bằng Stable Fast 3D

### 1. Clone và cài SF3D

Từ root project:

```bash
bash scripts/setup-sf3d.sh
```

Script sẽ clone repo vào:

```txt
third_party/stable-fast-3d
```

Bạn cần cài PyTorch đúng máy trước khi cài requirements của SF3D. Với NVIDIA GPU, chọn command PyTorch phù hợp CUDA của máy.

### 2. Xin quyền tải model weight

SF3D weight trên Hugging Face là gated. Bạn cần:

```bash
cd third_party/stable-fast-3d
source .venv/bin/activate
huggingface-cli login
```

Sau đó request/accept license của model `stabilityai/stable-fast-3d` trên Hugging Face.

### 3. Chạy worker ở chế độ SF3D

```bash
cd ai-worker
source .venv/bin/activate
export AI_PROVIDER=sf3d
export SF3D_REPO_PATH="$(pwd)/../third_party/stable-fast-3d"
export PYTHON_BIN="$(pwd)/../third_party/stable-fast-3d/.venv/bin/python"
uvicorn app.main:app --reload --port 8000
```

Giữ frontend chạy bằng:

```bash
yarn dev
```

## Env chính

Frontend `.env.local`:

```bash
AI_WORKER_URL=http://localhost:8000
NEXT_PUBLIC_MAX_UPLOAD_MB=20
```

Worker env:

```bash
AI_PROVIDER=mock       # hoặc sf3d
SF3D_REPO_PATH=../third_party/stable-fast-3d
PYTHON_BIN=../third_party/stable-fast-3d/.venv/bin/python
SF3D_CLEAN_ARTIFACTS=1
SF3D_CLEAN_MIN_AREA_RATIO=0.025
SF3D_CLEAN_KEEP_AREA_RATIO=0.985
SF3D_CLEAN_DROP_LOWER_RATIO=0
STORAGE_DIR=./storage
PUBLIC_BASE_URL=http://localhost:8000
MAX_UPLOAD_MB=20
ALLOWED_ORIGINS=http://localhost:3000
```

## API worker

Tạo job:

```bash
curl -X POST http://localhost:8000/api/jobs \
  -F "image=@/path/to/object.png" \
  -F "texture_resolution=1024" \
  -F "remesh_option=none" \
  -F "target_vertex_count=-1" \
  -F "foreground_ratio=0.85" \
  -F "drop_lower_ratio=0"
```

Lấy trạng thái:

```bash
curl http://localhost:8000/api/jobs/<job_id>
```

Tải model:

```bash
curl -L http://localhost:8000/api/jobs/<job_id>/model.glb -o model.glb
```

## Gợi ý nâng cấp production

- Dùng Redis + Celery/RQ thay cho background task in-process.
- Lưu output GLB lên S3/R2 thay vì disk local.
- Thêm auth, credit system, rate limit.
- Tạo thumbnail bằng Blender headless hoặc trimesh render.
- Thêm content moderation cho ảnh upload.
- Tách GPU worker thành service riêng để scale.
- Thêm provider Hunyuan3D hoặc SPAR3D nếu bạn có GPU mạnh hơn.

## Cấu trúc thư mục

```txt
free-image-to-3d-studio/
  src/                    # Next.js frontend
  ai-worker/              # FastAPI worker
  scripts/setup-sf3d.sh   # clone/cài Stable Fast 3D
  third_party/            # không commit; chứa SF3D repo sau khi setup
```
