import os
import re
import json
import base64
from pathlib import Path
from io import BytesIO
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv, dotenv_values
from PIL import Image

# Load environment variables from .env file in the application directory
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=True)

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Max upload image size: 5 MB
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

def get_current_api_key() -> str:
    """Reads GEMINI_API_KEY directly from the project's .env file, falling back to os.environ."""
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        vals = dotenv_values(dotenv_path=env_path)
        key = vals.get("GEMINI_API_KEY")
        if key and key.strip():
            return key.strip()
    return os.getenv("GEMINI_API_KEY", "").strip()

def get_configured_model() -> tuple[str, str]:
    """Returns (raw_model_id, clean_model_id_for_api) read from project .env."""
    env_path = BASE_DIR / ".env"
    raw = ""
    if env_path.exists():
        vals = dotenv_values(dotenv_path=env_path)
        raw = (vals.get("GEMMA_MODEL_ID") or "").strip()
    if not raw:
        raw = os.getenv("GEMMA_MODEL_ID", "gemma-2-27b-it").strip() or "gemma-2-27b-it"
    clean = raw.removeprefix("models/")
    return raw, clean

# Set of verified multimodal Gemma models supporting image input
MULTIMODAL_GEMMA_MODELS = {
    "gemma-4-26b-a4b-it",
    "gemma-3-multimodal",
    "gemma-4-vision"
}

def is_model_vision_capable(model_id: str) -> bool:
    """Check if the configured Gemma model is verified to support image input."""
    model_lower = model_id.lower().removeprefix("models/")
    return (
        model_lower in MULTIMODAL_GEMMA_MODELS
        or any(name in model_lower for name in MULTIMODAL_GEMMA_MODELS)
        or "vision" in model_lower
        or "gemma-4" in model_lower
    )

_genai_client = None
_cached_key = None

def get_genai_client():
    """Initializes and returns the official google-genai client singleton using project .env key."""
    global _genai_client, _cached_key
    api_key = get_current_api_key()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set. Please add your key to the .env file.")
    
    if _genai_client is None or _cached_key != api_key:
        try:
            from google import genai
        except ImportError:
            raise ImportError(
                "The 'google-genai' SDK is not installed. Please run: pip install -r requirements.txt"
            )
        # Explicitly pass api_key read from project's .env
        _genai_client = genai.Client(api_key=api_key)
        _cached_key = api_key
    
    return _genai_client


# Simplified, concise explanation modes
STYLE_PROMPTS = {
    "quick_easy": (
        "Explain this concept in 3 to 5 short sentences using plain language and, when useful, one everyday analogy. "
        "Keep it concise, readable, and directly relevant to the student's question."
    ),
    "step_by_step": (
        "Provide 3 to 5 short numbered steps with clear explanations. "
        "Keep each step concise and focused on the solution or reasoning."
    ),
    "exam_ready": (
        "Provide a short definition, 3 to 5 important points, and one brief example. "
        "Keep it structured, concise, and exam-focused."
    )
}

# Alias for backwards compatibility
STYLE_PROMPTS["simple"] = STYLE_PROMPTS["quick_easy"]

# Helper functions for Quiz Parsing and Grading
def normalize_text(text: str) -> str:
    """Normalizes text by removing outer quotes, punctuation, and extra whitespace."""
    if not text:
        return ""
    text = text.strip().lower()
    # Remove quotes, semicolons, exclamation marks, question marks, brackets
    for ch in ['"', "'", ';', ':', '!', '?', '(', ')', '[', ']', '{', '}']:
        text = text.replace(ch, '')
    # Remove trailing periods or commas
    text = re.sub(r'[\.,]+$', '', text)
    # Collapse multiple whitespaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def parse_num(val_str: str):
    """Attempts to parse a string as a float or simple fraction."""
    try:
        val_str = val_str.strip()
        if '/' in val_str:
            p = val_str.split('/')
            if len(p) == 2 and float(p[1]) != 0:
                return float(p[0]) / float(p[1])
        return float(val_str)
    except Exception:
        return None

def check_short_answer(user_ans: str, correct_ans: str, alternatives=None) -> bool:
    """
    Compares user short-answer against correct answer and alternatives.
    Uses case-insensitive matching after whitespace trimming.
    Does NOT mark correct merely because it contains one matching word.
    """
    if not user_ans:
        return False
    norm_user = normalize_text(user_ans)
    if not norm_user:
        return False

    candidates = [correct_ans]
    if alternatives and isinstance(alternatives, list):
        candidates.extend(alternatives)

    num_user = parse_num(norm_user)

    for cand in candidates:
        if not cand:
            continue
        norm_cand = normalize_text(str(cand))
        if norm_user == norm_cand:
            return True

        # Check numeric equivalence (e.g. 0.5 vs 1/2)
        num_cand = parse_num(norm_cand)
        if num_user is not None and num_cand is not None:
            if abs(num_user - num_cand) < 1e-4:
                return True

    return False

def extract_option_text(raw_opt) -> str:
    """Extracts clean option text from whatever format Gemma produces."""
    if not raw_opt:
        return ""
    if isinstance(raw_opt, dict):
        if "text" in raw_opt and raw_opt["text"]:
            val = raw_opt["text"]
            if isinstance(val, (dict, list)):
                return extract_option_text(val)
            return str(val).strip()
        if "option" in raw_opt and raw_opt["option"]:
            return str(raw_opt["option"]).strip()
        if "value" in raw_opt and raw_opt["value"]:
            return str(raw_opt["value"]).strip()
        for k in ["A", "B", "C", "D", "a", "b", "c", "d"]:
            if k in raw_opt:
                return str(raw_opt[k]).strip()
        if raw_opt:
            return str(next(iter(raw_opt.values()))).strip()
        return "Option"

    val_str = str(raw_opt).strip()
    # Check if val_str is a stringified python dict like "{'key': 'A', 'text': '...'}"
    if val_str.startswith("{") and val_str.endswith("}"):
        m = re.search(r"['\"]text['\"]\s*:\s*['\"]([^'\"]+)['\"]", val_str)
        if m:
            return m.group(1).strip()
        try:
            parsed_d = json.loads(val_str.replace("'", '"'))
            return extract_option_text(parsed_d)
        except Exception:
            pass

    clean_text = re.sub(r"^[A-Da-d][\)\.\:\-]\s*", "", val_str)
    return clean_text.strip()

def parse_and_validate_quiz(raw_text: str):
    """
    Parses and normalizes raw Gemma response into exactly 5 questions:
    3 Multiple Choice (A, B, C, D) followed by 2 Short Answer questions.
    """
    if not raw_text:
        raise ValueError("The Gemma model returned an empty response.")

    cleaned = raw_text.strip()
    # Strip markdown code fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    parsed = None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: extract substring between first { and last }
        match = re.search(r"(\{.*\})", cleaned, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

    if not parsed or not isinstance(parsed, dict) or "questions" not in parsed:
        raise ValueError("Could not parse structured questions from model output. Please try generating again.")

    raw_questions = parsed.get("questions", [])
    if not isinstance(raw_questions, list) or len(raw_questions) < 5:
        raise ValueError("The model generated fewer than the required 5 questions. Please try generating again.")

    normalized = []
    # Force exactly 5 questions: 3 MCQs (idx 0,1,2), 2 Short Answers (idx 3,4)
    for idx in range(5):
        q = raw_questions[idx] if idx < len(raw_questions) else {}
        q_id = idx + 1
        q_type = "mcq" if idx < 3 else "short_answer"
        question_text = q.get("question") or f"Question {q_id}"
        explanation = q.get("explanation") or "Review the explanation above for details."
        correct_ans = q.get("correct_answer") or ""

        if q_type == "mcq":
            raw_options = q.get("options", [])
            norm_options = []
            keys = ["A", "B", "C", "D"]

            if isinstance(raw_options, dict):
                for k in keys:
                    val = raw_options.get(k, raw_options.get(k.lower(), f"Option {k}"))
                    norm_options.append({"key": k, "text": extract_option_text(val)})
            elif isinstance(raw_options, list):
                for i, opt in enumerate(raw_options[:4]):
                    opt_k = keys[i]
                    if isinstance(opt, dict) and opt.get("key") and str(opt.get("key")).upper() in keys:
                        opt_k = str(opt.get("key")).upper()
                    norm_options.append({"key": opt_k, "text": extract_option_text(opt)})
                while len(norm_options) < 4:
                    k = keys[len(norm_options)]
                    norm_options.append({"key": k, "text": f"Option {k}"})
            else:
                for k in keys:
                    norm_options.append({"key": k, "text": f"Option {k}"})

            # Normalize correct_answer key (A, B, C, or D)
            ca_clean = str(correct_ans).strip()
            if isinstance(correct_ans, dict):
                if "key" in correct_ans and str(correct_ans["key"]).upper() in keys:
                    ca_clean = str(correct_ans["key"]).upper()
                elif "correct_answer" in correct_ans:
                    ca_clean = str(correct_ans["correct_answer"]).strip()
            elif ca_clean.startswith("{") and ca_clean.endswith("}"):
                m_key = re.search(r"['\"]key['\"]\s*:\s*['\"]([A-Da-d])['\"]", ca_clean)
                if m_key:
                    ca_clean = m_key.group(1).upper()

            norm_ca = None
            if ca_clean.upper() in keys:
                norm_ca = ca_clean.upper()
            elif len(ca_clean) >= 2 and ca_clean[0].upper() in keys and ca_clean[1] in [")", ".", ":", "-", " "]:
                norm_ca = ca_clean[0].upper()
            else:
                ca_lower = extract_option_text(ca_clean).lower()
                for opt in norm_options:
                    if opt["text"].strip().lower() == ca_lower:
                        norm_ca = opt["key"]
                        break
            if not norm_ca:
                norm_ca = "A"

            normalized.append({
                "id": q_id,
                "type": "mcq",
                "question": question_text,
                "options": norm_options,
                "correct_answer": norm_ca,
                "explanation": explanation
            })

        else:
            # Short answer question
            alternatives = q.get("acceptable_alternatives", [])
            if not isinstance(alternatives, list):
                alternatives = [str(alternatives)] if alternatives else []

            normalized.append({
                "id": q_id,
                "type": "short_answer",
                "question": question_text,
                "correct_answer": str(correct_ans).strip() or "Standard definition",
                "acceptable_alternatives": [str(a).strip() for a in alternatives if a],
                "explanation": explanation
            })

    return normalized

@app.route("/")
def index():
    """Renders the main SnapExplain AI interface."""
    import time
    return render_template("index.html", cache_version=int(time.time()))

@app.route("/api/health", methods=["GET"])
def health_check():
    """Returns backend system status, model configuration, and key availability."""
    raw_model, _ = get_configured_model()
    current_key = get_current_api_key()
    has_key = bool(current_key and not current_key.startswith("your_"))
    vision_supported = is_model_vision_capable(raw_model)
    
    sdk_installed = False
    try:
        import google.genai  # noqa: F401
        sdk_installed = True
    except ImportError:
        sdk_installed = False

    return jsonify({
        "status": "healthy",
        "has_api_key": has_key,
        "sdk_installed": sdk_installed,
        "configured_model": raw_model,
        "vision_supported": vision_supported,
        "message": (
            "Ready to explain" if has_key and sdk_installed
            else "Action needed: Add your GEMINI_API_KEY to .env" if not has_key
            else "Action needed: Install dependencies via 'pip install -r requirements.txt'"
        )
    })

@app.route("/api/explain", methods=["POST"])
def explain_question():
    """
    Accepts question, explanation style, and optional image (via multipart form or JSON base64).
    Generates concise explanation strictly using the verified Gemma model.
    """
    raw_model, model_to_use = get_configured_model()

    image_file = None
    image_b64 = None

    if request.is_json:
        data = request.get_json(silent=True) or {}
        question = (data.get("question") or "").strip()
        style = data.get("style", "quick_easy").strip().lower()
        image_b64 = data.get("image")
    else:
        question = (request.form.get("question") or "").strip()
        style = (request.form.get("style") or "quick_easy").strip().lower()
        image_b64 = request.form.get("image")
        image_file = request.files.get("image")

    has_image = bool(image_file or image_b64)
    if not question and not has_image:
        return jsonify({
            "success": False,
            "error": "Please enter a question or upload an image to explain."
        }), 400

    if style not in STYLE_PROMPTS:
        style = "quick_easy"

    current_key = get_current_api_key()
    if not current_key or current_key.startswith("your_"):
        return jsonify({
            "success": False,
            "error": "API Key Missing: Please paste your Google AI Studio API key into the .env file (GEMINI_API_KEY=...) and restart the app.",
            "code": "MISSING_API_KEY"
        }), 401

    if has_image and not is_model_vision_capable(raw_model):
        return jsonify({
            "success": False,
            "error": f"The configured open-weight model '{raw_model}' does not support image analysis. Please use a vision-capable Gemma checkpoint (e.g. gemma-4-26b-a4b-it).",
            "code": "VISION_NOT_SUPPORTED"
        }), 400

    # Process and validate image safely in memory
    model_image = None
    if has_image:
        try:
            raw_bytes = None
            if image_file:
                fn = (image_file.filename or "").lower()
                ext = Path(fn).suffix
                if ext and ext not in ALLOWED_IMAGE_EXTENSIONS:
                    return jsonify({
                        "success": False,
                        "error": f"Unsupported image format '{ext}'. Please upload a PNG, JPEG, or WEBP image."
                    }), 400
                
                raw_bytes = image_file.read()
                if len(raw_bytes) > MAX_IMAGE_BYTES:
                    return jsonify({
                        "success": False,
                        "error": "Image file exceeds the 5MB size limit. Please upload a smaller image."
                    }), 400
                if len(raw_bytes) == 0:
                    return jsonify({
                        "success": False,
                        "error": "The uploaded image file is empty."
                    }), 400
            elif image_b64:
                if "," in image_b64:
                    image_b64 = image_b64.split(",", 1)[1]
                raw_bytes = base64.b64decode(image_b64)
                if len(raw_bytes) > MAX_IMAGE_BYTES:
                    return jsonify({
                        "success": False,
                        "error": "Image exceeds the 5MB size limit."
                    }), 400

            if raw_bytes:
                # Open with Pillow and normalize to in-memory PNG buffer for Gemma
                loaded_img = Image.open(BytesIO(raw_bytes)).convert("RGB")
                png_buf = BytesIO()
                loaded_img.save(png_buf, format="PNG")
                png_buf.seek(0)
                model_image = Image.open(png_buf)
        except Exception as img_err:
            return jsonify({
                "success": False,
                "error": f"Could not process image: {str(img_err)}. Please ensure it is a valid PNG, JPEG, or WEBP file."
            }), 400

    try:
        client = get_genai_client()
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "code": "CLIENT_INIT_ERROR"
        }), 500

    style_instruction = STYLE_PROMPTS[style]
    system_instruction = (
        "You are SnapExplain AI, an expert, patient, and engaging academic tutor powered strictly by the Gemma open-weight model. "
        "Your mission is to make difficult concepts crystal-clear for students. "
        "Keep responses concise, readable, and directly relevant to the student's question or diagram. "
        "Use clean Markdown formatting with clear headers (##, ###), bullet points, and bold keywords."
    )
    
    question_prompt = question if question else "Please solve, analyze, and explain the question, formula, or diagram shown in this image."

    full_prompt = (
        f"{system_instruction}\n\n"
        f"Style Request: {style_instruction}\n\n"
        f"Student Question / Context:\n\"\"\"{question_prompt}\"\"\"\n\n"
        f"Provide the explanation now in the requested style:"
    )

    contents = [full_prompt, model_image] if model_image is not None else full_prompt

    try:
        response = None
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=model_to_use,
                    contents=contents,
                )
                if response and response.text:
                    break
            except Exception as call_err:
                if attempt == 0 and ("500" in str(call_err) or "INTERNAL" in str(call_err)):
                    import time
                    time.sleep(1)
                    continue
                raise call_err

        if not response or not response.text:
            return jsonify({
                "success": False,
                "error": "The model returned an empty response. Please try rephrasing your question.",
                "code": "EMPTY_RESPONSE"
            }), 502

        return jsonify({
            "success": True,
            "explanation": response.text,
            "model_used": raw_model,
            "style": style,
            "has_image": bool(model_image is not None)
        })

    except Exception as e:
        err_msg = str(e)
        user_friendly_error = "An error occurred while connecting to the Gemma model API."
        
        if any(term in err_msg for term in ["API_KEY_INVALID", "ACCESS_TOKEN_TYPE_UNSUPPORTED", "UNAUTHENTICATED", "401"]) or ("400" in err_msg and "key" in err_msg.lower()):
            user_friendly_error = "Invalid API Key: Please verify that your GEMINI_API_KEY in the .env file is correct, active, and copied directly from Google AI Studio."
        elif "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            user_friendly_error = "Rate limit reached: Google AI Studio has temporarily throttled requests. Please wait a minute and try again."
        elif "NOT_FOUND" in err_msg or "404" in err_msg:
            user_friendly_error = (
                f"Model Not Found: The model '{raw_model}' was not found on your Google AI API tier. "
                "You can change GEMMA_MODEL_ID in .env to another supported Gemma model like 'gemma-2-9b-it' or 'gemma-2-27b-it'."
            )
        elif "certificate" in err_msg.lower() or "ssl" in err_msg.lower():
            user_friendly_error = f"SSL Certificate Error: {err_msg}"
        elif "connection" in err_msg.lower() or "timeout" in err_msg.lower():
            user_friendly_error = f"Network Timeout / Connection Error: {err_msg}"
        else:
            user_friendly_error = f"API Error: {err_msg}"

        return jsonify({
            "success": False,
            "error": user_friendly_error,
            "raw_details": err_msg,
            "error_type": type(e).__name__
        }), 500


@app.route("/api/quiz", methods=["POST"])
@app.route("/api/practice", methods=["POST"])
def generate_practice_quiz():
    """
    Generates exactly 5 practice questions based on the question and explanation:
    - Exactly 3 Multiple Choice Questions (A, B, C, D)
    - Exactly 2 Short Answer Questions
    Strictly queries the verified Gemma model and returns structured JSON.
    """
    data = request.get_json(silent=True) or {}
    original_question = (data.get("original_question") or "").strip()
    explanation_context = (data.get("explanation") or "").strip()

    if not original_question and not explanation_context:
        return jsonify({
            "success": False,
            "error": "Original question or explanation context is required to generate a practice quiz."
        }), 400

    current_key = get_current_api_key()
    if not current_key or current_key.startswith("your_"):
        return jsonify({
            "success": False,
            "error": "API Key Missing: Please configure your GEMINI_API_KEY in .env to generate practice quizzes."
        }), 401

    try:
        client = get_genai_client()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    prompt = (
        f"Generate a 5-question practice quiz based on: {original_question}\n"
        f"Context from explanation: {explanation_context[:800]}\n\n"
        "Instructions:\n"
        "- Generate exactly 3 multiple choice questions (type: 'mcq') with 4 options labeled A, B, C, D and the correct option key in 'correct_answer'.\n"
        "- Generate exactly 2 short answer questions (type: 'short_answer') requiring a concise 1 to 5 word answer in 'correct_answer'.\n"
        "- Include a 1-sentence 'explanation' for each question.\n\n"
        "Return the quiz as a valid JSON object with a 'questions' array containing these 5 question items."
    )

    raw_model, model_to_use = get_configured_model()

    try:
        response = None
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=model_to_use,
                    contents=prompt,
                )
                if response and response.text:
                    break
            except Exception as call_err:
                if attempt == 0 and ("500" in str(call_err) or "INTERNAL" in str(call_err)):
                    import time
                    time.sleep(1)
                    continue
                raise call_err

        raw_text = (response.text or "").strip()
        normalized_questions = parse_and_validate_quiz(raw_text)

        return jsonify({
            "success": True,
            "questions": normalized_questions,
            "model_used": raw_model
        })

    except Exception as e:
        err_msg = str(e)
        user_friendly_error = f"Failed to generate practice quiz: {err_msg}"
        if any(term in err_msg for term in ["API_KEY_INVALID", "ACCESS_TOKEN_TYPE_UNSUPPORTED", "UNAUTHENTICATED", "401"]):
            user_friendly_error = "Invalid API Key: Please verify that your GEMINI_API_KEY in the .env file is active."
        return jsonify({
            "success": False,
            "error": user_friendly_error,
            "raw_details": err_msg
        }), 500

@app.route("/api/grade-quiz", methods=["POST"])
def grade_quiz():
    """
    Grades submitted quiz answers:
    - 1 point for each correct answer (Max score: 5).
    - Compares MCQ selections with correct options.
    - Compares short answers using case-insensitive normalized comparison and acceptable alternatives.
    """
    data = request.get_json(silent=True) or {}
    questions = data.get("questions") or []
    user_answers = data.get("answers") or {}

    if not questions or not isinstance(questions, list):
        return jsonify({
            "success": False,
            "error": "Missing quiz questions to grade."
        }), 400

    score = 0
    total = len(questions)
    results = []

    for q in questions:
        q_id = str(q.get("id"))
        q_type = q.get("type", "mcq")
        correct_ans = q.get("correct_answer", "")
        explanation = q.get("explanation", "")
        user_ans = str(user_answers.get(q_id, "")).strip()

        is_correct = False

        if q_type == "mcq":
            # Compare selected option key (A, B, C, D)
            is_correct = (user_ans.upper() == str(correct_ans).strip().upper())
        else:
            # Short answer validation
            alternatives = q.get("acceptable_alternatives", [])
            is_correct = check_short_answer(user_ans, correct_ans, alternatives)

        if is_correct:
            score += 1

        results.append({
            "id": q.get("id"),
            "type": q_type,
            "user_answer": user_ans,
            "correct_answer": correct_ans,
            "is_correct": is_correct,
            "explanation": explanation
        })

    percentage = round((score / total) * 100) if total > 0 else 0

    return jsonify({
        "success": True,
        "score": score,
        "total": total,
        "percentage": percentage,
        "results": results
    })

@app.errorhandler(400)
def handle_bad_request(err):
    return jsonify({
        "success": False,
        "error": "Bad request",
        "raw_details": str(err)
    }), 400

@app.errorhandler(500)
def handle_internal_error(err):
    return jsonify({
        "success": False,
        "error": "Internal server error occurred.",
        "raw_details": str(err)
    }), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    # Avoid unnecessary watchdog auto-reloads caused by site-packages file touches
    use_reloader = os.getenv("FLASK_USE_RELOADER", "false").lower() in ("true", "1", "yes")
    raw_model, _ = get_configured_model()
    print(f"[*] SnapExplain AI starting on http://127.0.0.1:{port}")
    print(f"[*] Configured Gemma Model: {raw_model}")
    print(f"[*] Auto-reloader: {'enabled' if use_reloader else 'disabled (prevents watchdog package reloads)'}")
    app.run(host="127.0.0.1", port=port, debug=True, use_reloader=use_reloader)

