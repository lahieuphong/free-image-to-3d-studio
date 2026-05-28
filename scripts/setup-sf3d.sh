#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THIRD_PARTY_DIR="$ROOT_DIR/third_party"
SF3D_DIR="$THIRD_PARTY_DIR/stable-fast-3d"

mkdir -p "$THIRD_PARTY_DIR"

if [ ! -d "$SF3D_DIR/.git" ]; then
  git clone https://github.com/Stability-AI/stable-fast-3d "$SF3D_DIR"
else
  echo "Stable Fast 3D repo đã tồn tại: $SF3D_DIR"
fi

cd "$SF3D_DIR"
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools==69.5.1 wheel

echo ""
echo "QUAN TRỌNG: cài PyTorch đúng CUDA/MPS/CPU của máy bạn trước khi pip install requirements.txt."
echo "Ví dụ CUDA thường xem ở https://pytorch.org/get-started/locally/"
echo ""
read -r -p "Bạn đã cài PyTorch phù hợp trong venv này chưa? Gõ y để tiếp tục cài requirements SF3D: " ok
if [ "$ok" != "y" ]; then
  echo "Dừng tại đây. Sau khi cài PyTorch, chạy lại script hoặc tự chạy: pip install -r requirements.txt"
  exit 0
fi

pip install -r requirements.txt

echo ""
echo "Xong. Thêm các biến này vào ai-worker/.env hoặc export trước khi chạy worker:"
echo "AI_PROVIDER=sf3d"
echo "SF3D_REPO_PATH=$SF3D_DIR"
echo "PYTHON_BIN=$SF3D_DIR/.venv/bin/python"
echo ""
echo "SF3D model trên Hugging Face là gated: bạn cần request access và chạy huggingface-cli login trong venv."
