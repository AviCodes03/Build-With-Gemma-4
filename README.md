# SnapExplain AI 🎓

> **"Ask. Understand. Master."**  
> Built for the **Best Use of Gemma** Hackathon Challenge.

SnapExplain AI is a modern, student-centric academic tutoring application powered strictly by Google's open-weight **Gemma** models via the official `google-genai` Python SDK. It breaks down complex homework questions, formulas, and concepts into concise explanations, provides 3 distinct learning styles, and dynamically generates interactive 5-question practice quizzes with automated grading to test student retention.

---

## ✨ Features

- **Gemma Open-Weight AI Core:** Calls verified Gemma models (e.g. `gemma-2-27b-it` or `gemma-2-9b-it`) via Google's official GenAI API.
- **3 Simplified Explanation Modes:**
  - 🌱 **Quick & Easy:** Explains concepts in 3–5 short sentences using plain language and one everyday analogy.
  - 🪜 **Step-by-Step:** Provides 3–5 short numbered steps with clear explanations.
  - 🎯 **Exam Ready:** Provides a concise definition, 3–5 high-yield points, and one brief example.
- **Interactive 5-Question Practice Quiz:**
  - Generates exactly **3 Multiple-Choice Questions (A, B, C, D)** and **2 Short-Answer Questions** based directly on the explanation.
  - **Automated Grading:** Compares MCQ choices and validates short answers using case-insensitive normalization, synonym acceptance, and numeric equivalence (without falsely matching single loose words).
  - **Detailed Feedback:** Shows total score out of 5, correct answers, and explanations for each question.
  - **Try Again:** Lets students reset and retry the quiz seamlessly without reloading the page.
- **Model Capability Guard:** Automatically verifies model modalities (disables image input gracefully on text-only Gemma checkpoints).
- **Zero API Key Leakage:** Keys are loaded strictly from the server-side `.env` file and never exposed to the client browser, git, or logs.

---

## 📁 Project Structure

```text
Build With Gemma 4/
├── app.py                  # Flask backend with Gemma API & quiz grading endpoints
├── requirements.txt        # Minimal required dependencies
├── .env                    # Local secrets (ignored by Git)
├── .env.example            # Sample configuration template
├── .gitignore              # Protects secrets, virtual environments, and caches
├── README.md               # Setup and troubleshooting guide
├── templates/
│   └── index.html          # Clean, modern semantic UI with interactive quiz
└── static/
    ├── css/
    │   └── style.css       # Indigo & violet design system, responsive quiz cards
    └── js/
        └── app.js          # Reactive frontend logic, Markdown rendering, quiz handler
```

---

## 🚀 Quickstart Guide (Windows PowerShell)

Follow these simple steps to set up and run the project locally.

### Step 1: Open PowerShell in the project directory
Make sure your terminal is opened in your project folder:
```powershell
cd "c:\Users\manda\OneDrive\Desktop\Build With Gemma 4"
```

### Step 2: Create and activate a Python virtual environment
Creating a virtual environment ensures clean dependencies:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
*(If you see an execution policy error on PowerShell, run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` first).*

### Step 3: Install dependencies
Install the required packages:
```powershell
python -m pip install -r requirements.txt
```

> **Note on Pip Network Timeouts:** If your network experiences high latency or read timeouts when connecting to PyPI, you can increase pip's timeout:
> ```powershell
> python -m pip install --default-timeout=120 -r requirements.txt
> ```

---

## 🔑 Step 4: Configure your API Key Safely

1. Get a free Google AI Studio API key from:  
   👉 [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Open the `.env` file in this directory in your editor.
3. Paste your key after `GEMINI_API_KEY=`:
   ```env
   GEMINI_API_KEY=AIzaSyYourActualKeyHere
   GEMMA_MODEL_ID=gemma-2-27b-it
   PORT=5000
   ```
4. Save the file.  
   *(Notice that `.env` is listed in `.gitignore` so your private key will never be accidentally committed to GitHub).*

---

## 🏃 Step 5: Run the Application

Start the Flask development server:
```powershell
python app.py
```

You will see:
```text
🚀 SnapExplain AI starting on http://127.0.0.1:5000
🤖 Configured Gemma Model: gemma-2-27b-it
 * Running on http://127.0.0.1:5000
```

Open your browser and navigate to:  
👉 **`http://127.0.0.1:5000`**

---

## 🧪 Testing the New Features Locally

1. **Verify Backend Health:**
   - Look at the **System Status Card** on the top-left sidebar:
   - 🟢 **Connected to Gemma:** Backend and API key are valid and ready.
2. **Test Simplified Explanation Modes:**
   - Select **Quick & Easy** (verifies 3–5 short sentences + analogy).
   - Click an example chip like *Why divide by zero is undefined* or type your own question.
   - Click **"Explain with Gemma"**.
   - Try the other modes (**Step-by-Step** for 3–5 numbered steps; **Exam Ready** for definitions, 3–5 points & brief example).
3. **Test the 5-Question Practice Quiz:**
   - Below the generated explanation, click **"Generate Practice Quiz"**.
   - Gemma generates 3 MCQs with options A, B, C, D and 2 Short Answer fields.
   - Select answers for the MCQs and type answers for the short-answer questions.
   - Click **"Check Answers"**.
   - Confirm your score out of 5 is displayed along with green/red badges, the expected answers, and detailed explanations.
   - Click **"🔄 Try Again"** to reset the quiz inputs and test retention without reloading the page.
   - Click **"✨ Generate New Quiz"** to request a fresh set of questions.

---

## 🛠️ Troubleshooting Guide

| Issue | Likely Cause | Solution |
| :--- | :--- | :--- |
| **`ReadTimeoutError` during pip install** | Slow or intermittent internet connection to PyPI | Run `python -m pip install --default-timeout=120 -r requirements.txt` |
| **`404 Model Not Found`** | Configured `GEMMA_MODEL_ID` is unavailable on your API tier | Open `.env` and change `GEMMA_MODEL_ID=gemma-2-27b-it` to `gemma-2-9b-it` |
| **`API_KEY_INVALID` or `401 Unauthorized`** | Key is miscopied or has spaces | Re-check `.env` and verify there are no surrounding quotes or trailing spaces |
| **`RESOURCE_EXHAUSTED` (429 Rate Limit)** | Free tier quota limit reached temporarily | Wait 60 seconds before retrying; Google AI Studio free tier resets every minute |
| **`Script Execution Disabled` in PowerShell** | Windows PowerShell security restriction | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` then activate `.venv` again |
| **Image Upload Disabled** | Gemma 2 checkpoints are text-only models | Normal behavior. Type your question in text; if using a vision-capable Gemma checkpoint in the future, set `GEMMA_MODEL_ID` in `.env` |

---

## 📜 Hackathon Compliance
- Uses **Google's official `google-genai` SDK** (`from google import genai`).
- Strictly queries open-weight **Gemma** models (e.g. `gemma-2-27b-it` / `gemma-2-9b-it`).
- Does **not** use substitute proprietary Gemini-branded models or synthetic fake answers.
- Environment secrets follow 12-factor application security best practices.
