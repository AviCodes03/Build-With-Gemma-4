import os
import re
import json
import base64
from io import BytesIO
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Security configuration & model settings
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
# Default to official Gemma open-weight model on Google AI Studio API
GEMMA_MODEL_ID = os.getenv("GEMMA_MODEL_ID", "gemma-2-27b-it").strip()

# Set of known Gemma models and their multimodal capability
# Gemma 2 models (9b, 27b) are text-only open models.
MULTIMODAL_GEMMA_MODELS = {"gemma-3-multimodal", "gemma-4-vision"}  # extensible for vision-enabled Gemma variants

def is_model_vision_capable(model_id: str) -> bool:
    """Check if the configured Gemma model is verified to support image input."""
    model_lower = model_id.lower()
    return any(name in model_lower for name in MULTIMODAL_GEMMA_MODELS) or "vision" in model_lower

def get_genai_client():
    """Initializes and returns the official google-genai client."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set. Please add your key to the .env file.")
    
    try:
        from google import genai
    except ImportError:
        raise ImportError(
            "The 'google-genai' SDK is not installed. Please run: pip install -r requirements.txt"
        )
    
    # Initialize the official SDK client
    return genai.Client(api_key=api_key)

STYLE_PROMPTS = {
    "simple": (
        "Explain this question or concept in very simple, beginner-friendly terms (ELI5 style). "
        "Use an engaging real-world analogy, break down all complex terms, and focus on intuitive understanding. "
        "Keep the tone encouraging, warm, and easy to read with bullet points."
    ),
    "step_by_step": (
        "Provide a structured, step-by-step breakdown solving or explaining this question. "
        "1. Identify the core problem and known parameters.\n"
        "2. Break down the solution logically with numbered steps.\n"
        "3. Highlight common mistakes or traps where students usually lose marks.\n"
        "4. Summarize the final takeaway."
    ),
    "exam_ready": (
        "Provide a high-scoring, formal exam-ready answer. "
        "Include:\n"
        "- Formal definition or core theorem.\n"
        "- High-yield keywords and phrases examiners look for (bold these).\n"
        "- Step-by-step derivation or argument for maximum marks.\n"
        "- Common marks loss warnings.\n"
        "- Quick 1-minute revision summary box."
    )
}

@app.route("/")
def index():
    """Renders the main SnapExplain AI interface."""
    return render_template("index.html")

@app.route("/api/health", methods=["GET"])
def health_check():
    """Returns backend system status, model configuration, and key availability."""
    current_key = os.getenv("GEMINI_API_KEY", "").strip()
    has_key = bool(current_key and not current_key.startswith("your_"))
    vision_supported = is_model_vision_capable(GEMMA_MODEL_ID)
    
    # Check if google-genai package is installed
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
        "configured_model": GEMMA_MODEL_ID,
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
    Accepts question, explanation style, and optional image.
    Generates explanation strictly using the verified Gemma model.
    """
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    style = data.get("style", "simple").strip().lower()
    image_b64 = data.get("image")  # Optional base64-encoded image string

    if not question and not image_b64:
        return jsonify({
            "success": False,
            "error": "Please enter a question or problem to explain."
        }), 400

    if style not in STYLE_PROMPTS:
        style = "simple"

    # Verify API key before proceeding
    current_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not current_key or current_key.startswith("your_"):
        return jsonify({
            "success": False,
            "error": "API Key Missing: Please paste your Google AI Studio API key into the .env file (GEMINI_API_KEY=...) and restart the app.",
            "code": "MISSING_API_KEY"
        }), 401

    # Check image capability
    if image_b64 and not is_model_vision_capable(GEMMA_MODEL_ID):
        return jsonify({
            "success": False,
            "error": f"The configured open-weight model '{GEMMA_MODEL_ID}' is a text-only model. Image analysis is not supported by this Gemma checkpoint. Please type or paste the text of your question.",
            "code": "VISION_NOT_SUPPORTED"
        }), 400

    try:
        client = get_genai_client()
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "code": "CLIENT_INIT_ERROR"
        }), 500

    # Build the prompt
    style_instruction = STYLE_PROMPTS[style]
    system_instruction = (
        "You are SnapExplain AI, an expert, patient, and engaging academic tutor powered strictly by the Gemma open-weight model. "
        "Your mission is to make difficult concepts crystal-clear for students. "
        "Use clean Markdown formatting with clear headers (##, ###), bullet points, bold keywords, and code blocks or math formulas if applicable."
    )
    
    full_prompt = (
        f"{system_instruction}\n\n"
        f"Style Request: {style_instruction}\n\n"
        f"Student Question / Problem:\n\"\"\"{question}\"\"\"\n\n"
        f"Provide the explanation now in the requested style:"
    )

    try:
        # Call the official Gemma model via Google GenAI SDK
        response = client.models.generate_content(
            model=GEMMA_MODEL_ID,
            contents=full_prompt,
        )

        if not response or not response.text:
            return jsonify({
                "success": False,
                "error": "The model returned an empty response. Please try rephrasing your question.",
                "code": "EMPTY_RESPONSE"
            }), 502

        return jsonify({
            "success": True,
            "explanation": response.text,
            "model_used": GEMMA_MODEL_ID,
            "style": style
        })

    except Exception as e:
        err_msg = str(e)
        user_friendly_error = "An error occurred while connecting to the Gemma model API."
        
        # Categorize common errors to help beginners troubleshoot easily
        if "API_KEY_INVALID" in err_msg or "400" in err_msg and "key" in err_msg.lower():
            user_friendly_error = "Invalid API Key: Please verify that your GEMINI_API_KEY in the .env file is correct and active."
        elif "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg:
            user_friendly_error = "Rate limit reached: Google AI Studio has temporarily throttled requests. Please wait a minute and try again."
        elif "NOT_FOUND" in err_msg or "404" in err_msg:
            user_friendly_error = (
                f"Model Not Found: The model '{GEMMA_MODEL_ID}' was not found on your Google AI API tier. "
                "You can change GEMMA_MODEL_ID in .env to another supported Gemma model like 'gemma-2-9b-it' or 'gemma-2-27b-it'."
            )
        elif "connection" in err_msg.lower() or "timeout" in err_msg.lower():
            user_friendly_error = "Network timeout: Unable to reach Google AI servers. Check your internet connection."
        else:
            user_friendly_error = f"API Error: {err_msg}"

        return jsonify({
            "success": False,
            "error": user_friendly_error,
            "raw_details": err_msg
        }), 500

@app.route("/api/practice", methods=["POST"])
def practice_question():
    """
    Generates a related practice question, hint, and solution
    based on the original question and explanation.
    """
    data = request.get_json(silent=True) or {}
    original_question = (data.get("original_question") or "").strip()
    explanation_context = (data.get("explanation") or "").strip()

    if not original_question and not explanation_context:
        return jsonify({
            "success": False,
            "error": "Original question or explanation context is required to generate a practice problem."
        }), 400

    current_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not current_key or current_key.startswith("your_"):
        return jsonify({
            "success": False,
            "error": "API Key Missing: Please configure your GEMINI_API_KEY in .env to generate practice questions."
        }), 401

    try:
        client = get_genai_client()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    prompt = (
        "You are an academic tutor testing a student's understanding. "
        "Based on the following concept and explanation, generate ONE new, targeted practice question "
        "that tests the same core principle with fresh numbers or a slightly different scenario.\n\n"
        f"Original Topic/Question: {original_question}\n\n"
        f"Explanation Given: {explanation_context[:1000]}\n\n"
        "Format your answer EXACTLY in JSON with three keys:\n"
        "{\n"
        '  "practice_question": "The text of the practice question...",\n'
        '  "hint": "A gentle clue without giving away the full answer...",\n'
        '  "solution": "The complete, step-by-step solution and final answer..."\n'
        "}\n"
        "Respond ONLY with valid JSON. Do not include markdown code fences or other text."
    )

    try:
        response = client.models.generate_content(
            model=GEMMA_MODEL_ID,
            contents=prompt,
        )

        raw_text = (response.text or "").strip()
        # Clean potential markdown backticks ```json ... ```
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

        try:
            parsed = json.loads(cleaned)
            return jsonify({
                "success": True,
                "practice_question": parsed.get("practice_question", "No question generated."),
                "hint": parsed.get("hint", "Think about the core formula and definitions."),
                "solution": parsed.get("solution", "Solution not provided."),
                "model_used": GEMMA_MODEL_ID
            })
        except json.JSONDecodeError:
            # Fallback if model returned unstructured response
            return jsonify({
                "success": True,
                "practice_question": raw_text,
                "hint": "Break the question into smaller parts and recall the principles discussed above.",
                "solution": "Review the explanation above and apply the same steps to this scenario.",
                "model_used": GEMMA_MODEL_ID
            })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to generate practice question: {str(e)}"
        }), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"🚀 SnapExplain AI starting on http://127.0.0.1:{port}")
    print(f"🤖 Configured Gemma Model: {GEMMA_MODEL_ID}")
    app.run(host="127.0.0.1", port=port, debug=True)
