import io
import base64
from PIL import Image
import torch
import runpod
from transformers import AutoProcessor, AutoModelForImageTextToText, AutoModelForVision2Seq

device = "cuda" if torch.cuda.is_available() else "cpu"

#HuggingFaceTB/SmolVLM-500M-Instruct, HuggingFaceTB/SmolVLM2-2.2B-Instruct
model_path = "HuggingFaceTB/SmolVLM2-2.2B-Instruct"

#vision_processor = AutoProcessor.from_pretrained(model_path)
#vision_model = AutoModelForVision2Seq.from_pretrained(model_path, torch_dtype=torch.bfloat16).to(device)

vision_processor = AutoProcessor.from_pretrained(model_path)
vision_model = AutoModelForImageTextToText.from_pretrained(model_path, torch_dtype=torch.bfloat16).to(device)

TARGET_SIZE = (512, 512)


def handler(event):
    handlers = {
        'process_image': process_image,
        'check_relevance': check_relevance
    }
    
    job_input = event["input"]
    handler_key = next((key for key in handlers if key in job_input), None)
    return handlers[handler_key](job_input)


def preprocess_image(image):
    width, height = image.size
    crop_size = min(width, height)
    
    left = (width - crop_size) / 2
    top = (height - crop_size) / 2
    right = (width + crop_size) / 2
    bottom = (height + crop_size) / 2
    
    cropped_image = image.crop((left, top, right, bottom))
    return cropped_image.resize(TARGET_SIZE, Image.Resampling.LANCZOS)


def process_image(job_input):
    image_data = base64.b64decode(job_input['process_image'])
    image = Image.open(io.BytesIO(image_data))
    processed_image = preprocess_image(image)
    
    messages = [{
        "role": "user",
        "content": [
            {"type": "image"},
            {"type": "text", "text": "Generate a concise, visually detailed caption emphasizing key objects, actions, and overall scene context to facilitate accurate image similarity retrieval."}
        ]
    }]

    description_prompt = vision_processor.apply_chat_template(messages, add_generation_prompt=True)
    vision_inputs = vision_processor(text=description_prompt, images=[processed_image], return_tensors="pt").to(device, torch.bfloat16)

    with torch.no_grad():
        vision_outputs = vision_model.model(**vision_inputs)
        embeddings = vision_outputs.image_hidden_states[0, 0].cpu().float().numpy().tolist()
        description_token_ids = vision_model.generate(**vision_inputs, do_sample=False, max_new_tokens=64, min_new_tokens=32)
        description = vision_processor.batch_decode(description_token_ids, skip_special_tokens=True)[0].split("Assistant: ")[-1].strip()

    return {
        'success': True,
        'description': description,
        'image_embedding': embeddings
    }


def check_relevance(job_input):
    query = job_input['query']
    image_data = base64.b64decode(job_input['check_relevance'])
    image = Image.open(io.BytesIO(image_data))
    processed_image = preprocess_image(image)
    
    messages = [{
        "role": "user",
        "content": [
            {"type": "image"},
            {"type": "text", "text": f"Does the image have any relevance to the search query: '{query}'.\nPlease answer with a single word yes or no."}
        ]
    }]

    relevance_prompt = vision_processor.apply_chat_template(messages, add_generation_prompt=True)
    vision_inputs = vision_processor(text=relevance_prompt, images=[processed_image], return_tensors="pt").to(device, torch.bfloat16)

    with torch.no_grad():
        response_token_ids = vision_model.generate(**vision_inputs, do_sample=False, max_new_tokens=2, min_new_tokens=1)
        response = vision_processor.batch_decode(response_token_ids, skip_special_tokens=True)[0].split("Assistant: ")[-1].strip().strip(".")
        
        print(f"Query: {query}")
        print(f"Response: {response}")

    return {
        'success': True,
        'is_relevant': response.lower() != "no"
    }

runpod.serverless.start({"handler": handler})