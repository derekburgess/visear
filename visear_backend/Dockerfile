ARG BASE_IMAGE=pytorch/pytorch:2.2.1-cuda12.1-cudnn8-runtime
FROM ${BASE_IMAGE}

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install git+https://github.com/huggingface/transformers@v4.49.0-SmolVLM-2 \
    && pip install --no-cache-dir runpod huggingface_hub

COPY api/handler.py .

ENV HF_HOME=/app/model \
    CUDA_VISIBLE_DEVICES=0 \
    HF_TOKEN=""

EXPOSE 5000

CMD ["python", "handler.py"]