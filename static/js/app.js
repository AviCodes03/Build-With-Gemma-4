/**
 * SnapExplain AI — Client-side Application Logic
 * Integrates with Flask backend and handles UI states, Markdown rendering,
 * model health checks, explanation generation, and interactive 5-question quizzes.
 */

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const explainForm = document.getElementById("explainForm");
    const questionInput = document.getElementById("questionInput");
    const charCount = document.getElementById("charCount");
    const clearBtn = document.getElementById("clearBtn");
    const submitBtn = document.getElementById("submitBtn");
    
    // Status Elements
    const statusDot = document.getElementById("statusDot");
    const statusLabel = document.getElementById("statusLabel");
    const modelName = document.getElementById("modelName");
    const statusDetails = document.getElementById("statusDetails");
    const setupAlert = document.getElementById("setupAlert");
    const recheckStatusBtn = document.getElementById("recheckStatusBtn");
    const imageCapabilityBadge = document.getElementById("imageCapabilityBadge");
    const imageInput = document.getElementById("imageInput");
    const uploadTitle = document.getElementById("uploadTitle");
    const uploadHint = document.getElementById("uploadHint");

    // Output Views
    const emptyState = document.getElementById("emptyState");
    const loadingState = document.getElementById("loadingState");
    const loadingStep = document.getElementById("loadingStep");
    const answerView = document.getElementById("answerView");
    const explanationText = document.getElementById("explanationText");
    const answerStyleTag = document.getElementById("answerStyleTag");
    const answerModelTag = document.getElementById("answerModelTag");
    const copyBtn = document.getElementById("copyBtn");
    const copyText = document.getElementById("copyText");
    const toast = document.getElementById("toast");

    // Practice Quiz Elements
    // Practice Quiz Stepper Elements
    const generatePracticeBtn = document.getElementById("generatePracticeBtn");
    const practiceSpinner = document.getElementById("practiceSpinner");
    const practiceBtnText = document.getElementById("practiceBtnText");
    const quizCard = document.getElementById("quizCard");
    const quizModelBadge = document.getElementById("quizModelBadge");
    const quizProgressSection = document.getElementById("quizProgressSection");
    const quizProgressText = document.getElementById("quizProgressText");
    const quizTypeBadge = document.getElementById("quizTypeBadge");
    const quizProgressBar = document.getElementById("quizProgressBar");
    const quizQuestionCard = document.getElementById("quizQuestionCard");
    const quizQuestionPrompt = document.getElementById("quizQuestionPrompt");
    const quizInputContainer = document.getElementById("quizInputContainer");
    const quizFeedback = document.getElementById("quizFeedback");
    const quizNavActions = document.getElementById("quizNavActions");
    const quizPrevBtn = document.getElementById("quizPrevBtn");
    const quizCheckBtn = document.getElementById("quizCheckBtn");
    const quizCheckBtnText = document.getElementById("quizCheckBtnText");
    const quizNextBtn = document.getElementById("quizNextBtn");
    const quizNextBtnText = document.getElementById("quizNextBtnText");
    const gradeSpinner = document.getElementById("gradeSpinner");

    // Results Elements
    const quizScoreCard = document.getElementById("quizScoreCard");
    const scoreValue = document.getElementById("scoreValue");
    const scoreHeadline = document.getElementById("scoreHeadline");
    const scoreMessage = document.getElementById("scoreMessage");
    const quizResultsSummary = document.getElementById("quizResultsSummary");
    const tryAgainBtn = document.getElementById("tryAgainBtn");
    const newQuizBtn = document.getElementById("newQuizBtn");

    // State Variables
    let currentQuestion = "";
    let currentExplanation = "";
    let currentQuiz = [];
    let quizState = {
        currentIndex: 0,
        answers: {},
        checked: {},
        score: 0
    };
    let loadingInterval = null;

    // Helper: Format style name for UI badges
    function formatStyleName(style) {
        const map = {
            "quick_easy": "Quick & Easy",
            "simple": "Quick & Easy",
            "step_by_step": "Step-by-Step",
            "exam_ready": "Exam Ready"
        };
        return map[style] || style;
    }

    // Helper: Escape HTML to prevent XSS in rendered question text
    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper: Safely extract clean string option text without raw dict syntax or [object Object]
    function extractOptionText(opt) {
        if (opt === null || opt === undefined) return "";
        let text = "";
        if (typeof opt === "object") {
            if (typeof opt.text === "string") {
                text = opt.text;
            } else if (opt.text && typeof opt.text === "object") {
                text = extractOptionText(opt.text);
            } else if (typeof opt.option === "string") {
                text = opt.option;
            } else if (typeof opt.value === "string") {
                text = opt.value;
            } else {
                const vals = Object.values(opt);
                text = vals.length > 0 ? extractOptionText(vals[0]) : "";
            }
        } else {
            text = String(opt);
        }

        text = text.trim();
        // In case text is a stringified Python dict representation like "{'key': 'A', 'text': '...'}"
        if (text.startsWith("{") && text.endsWith("}")) {
            const match = text.match(/['"]text['"]\s*:\s*['"]([^'"]+)['"]/);
            if (match) {
                text = match[1];
            } else {
                try {
                    const parsed = JSON.parse(text.replace(/'/g, '"'));
                    return extractOptionText(parsed);
                } catch (e) {
                    text = text.replace(/^\{|\}$/g, "");
                }
            }
        }

        // Remove leading "A) ", "A. ", "A - ", "A: " if present
        text = text.replace(/^[A-Da-d][\)\.\:\-]\s*/, "");
        return text.trim();
    }

    // Helper: Protect Math blocks before marked, then restore and render
    function renderMarkdownWithMath(markdownContent) {
        if (!markdownContent) return "";

        const displayMath = [];
        const inlineMath = [];
        let protectedText = markdownContent;

        // 1. Display math: $$ ... $$ and \[ ... \]
        protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (m, math) => {
            const id = displayMath.length;
            displayMath.push(math);
            return `@@DISPLAYMATH_${id}@@`;
        });
        protectedText = protectedText.replace(/\\\[([\s\S]+?)\\\]/g, (m, math) => {
            const id = displayMath.length;
            displayMath.push(math);
            return `@@DISPLAYMATH_${id}@@`;
        });

        // 2. Inline math: \( ... \) and $ ... $
        protectedText = protectedText.replace(/\\\(([\s\S]+?)\\\)/g, (m, math) => {
            const id = inlineMath.length;
            inlineMath.push(math);
            return `@@INLINEMATH_${id}@@`;
        });
        // Protect $...$ if not currency like $50 or $19.99
        protectedText = protectedText.replace(/\$([^\s\$](?:[^\$]*?[^\s\$])?)\$/g, (m, math) => {
            if (/^\d+(\.\d{1,2})?$/.test(math.trim())) {
                return m;
            }
            const id = inlineMath.length;
            inlineMath.push(math);
            return `@@INLINEMATH_${id}@@`;
        });

        // Parse markdown
        let html = "";
        if (typeof marked !== "undefined" && marked.parse) {
            html = marked.parse(protectedText);
        } else {
            html = protectedText;
        }

        // Restore math
        html = html.replace(/@@DISPLAYMATH_(\d+)@@/g, (m, id) => {
            return `$$${displayMath[parseInt(id, 10)]}$$`;
        });
        html = html.replace(/@@INLINEMATH_(\d+)@@/g, (m, id) => {
            return `$${inlineMath[parseInt(id, 10)]}$`;
        });

        return html;
    }

    // Helper: Typeset all KaTeX math equations in an element
    function typesetMath(element) {
        if (!element) return;
        const render = () => {
            if (typeof renderMathInElement === "function") {
                try {
                    renderMathInElement(element, {
                        delimiters: [
                            { left: "$$", right: "$$", display: true },
                            { left: "\\[", right: "\\]", display: true },
                            { left: "$", right: "$", display: false },
                            { left: "\\(", right: "\\)", display: false }
                        ],
                        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
                        throwOnError: false
                    });
                    return true;
                } catch (e) {
                    console.warn("KaTeX typeset error:", e);
                }
            }
            return false;
        };

        if (!render()) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (render() || attempts > 15) {
                    clearInterval(timer);
                }
            }, 100);
        }
    }


    // -------------------------------------------------------------------------
    // 1. Initial System Health Check
    // -------------------------------------------------------------------------
    async function checkBackendHealth() {
        try {
            statusDot.className = "status-dot checking";
            statusLabel.textContent = "Checking model...";
            
            const response = await fetch("/api/health");
            if (!response.ok) throw new Error("Health check returned status " + response.status);
            
            const data = await response.json();
            
            // Update model badges
            modelName.textContent = data.configured_model || "Gemma";
            answerModelTag.textContent = data.configured_model || "Gemma";
            if (quizModelBadge) quizModelBadge.textContent = data.configured_model || "Gemma";

            if (data.has_api_key && data.sdk_installed) {
                statusDot.className = "status-dot connected";
                statusLabel.textContent = "Connected to Gemma";
                statusDetails.textContent = `Model ready: ${data.configured_model}`;
                setupAlert.classList.add("hidden");
            } else if (!data.has_api_key) {
                statusDot.className = "status-dot checking";
                statusLabel.textContent = "API Key Missing";
                statusDetails.textContent = "Add GEMINI_API_KEY to your .env file";
                setupAlert.classList.remove("hidden");
            } else if (!data.sdk_installed) {
                statusDot.className = "status-dot error";
                statusLabel.textContent = "SDK Not Installed";
                statusDetails.textContent = "Run: pip install -r requirements.txt";
                setupAlert.classList.remove("hidden");
                document.getElementById("alertTitle").textContent = "Dependencies Missing";
                document.getElementById("alertMessage").textContent = "Please install required packages using: pip install -r requirements.txt in your terminal.";
            }

            // Update Image Capability
            if (data.vision_supported) {
                imageCapabilityBadge.textContent = "Vision Enabled";
                imageCapabilityBadge.classList.add("supported");
                imageInput.removeAttribute("disabled");
                uploadTitle.textContent = "Drop question image here";
                uploadHint.textContent = "PNG, JPG up to 5MB supported";
            } else {
                imageCapabilityBadge.textContent = "Text-Only Model";
                imageCapabilityBadge.classList.remove("supported");
                imageInput.setAttribute("disabled", "true");
                uploadTitle.textContent = "Image upload disabled for this Gemma model";
                uploadHint.textContent = `${data.configured_model} is an open-weight text model. Type or paste your question text above.`;
            }

        } catch (err) {
            statusDot.className = "status-dot error";
            statusLabel.textContent = "Backend Offline";
            statusDetails.textContent = "Make sure 'python app.py' is running.";
            showToast("Could not connect to Flask server. Please ensure the app is running.", 4000);
        }
    }

    // Run health check on startup
    checkBackendHealth();

    if (recheckStatusBtn) {
        recheckStatusBtn.addEventListener("click", () => {
            checkBackendHealth();
            showToast("Rechecking backend status...", 2000);
        });
    }

    // -------------------------------------------------------------------------
    // 2. Character Count & Form Helpers
    // -------------------------------------------------------------------------
    function updateCharCount() {
        const length = questionInput.value.length;
        charCount.textContent = `${length} / 2500`;
    }

    questionInput.addEventListener("input", updateCharCount);

    clearBtn.addEventListener("click", () => {
        questionInput.value = "";
        updateCharCount();
        questionInput.focus();
    });

    // Style option cards toggle active styling
    const styleOptions = document.querySelectorAll(".style-option");
    styleOptions.forEach(option => {
        option.addEventListener("click", () => {
            styleOptions.forEach(opt => opt.classList.remove("active"));
            option.classList.add("active");
            const radio = option.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
        });
    });

    // Sidebar Example Chips
    const exampleChips = document.querySelectorAll(".example-chip");
    exampleChips.forEach(chip => {
        chip.addEventListener("click", () => {
            const prompt = chip.getAttribute("data-prompt");
            const style = chip.getAttribute("data-style") || "quick_easy";

            questionInput.value = prompt;
            updateCharCount();

            // Select matching style option
            styleOptions.forEach(opt => {
                const radio = opt.querySelector("input[type='radio']");
                if (radio && (radio.value === style || (style === "quick_easy" && radio.value === "simple"))) {
                    opt.classList.add("active");
                    radio.checked = true;
                } else {
                    opt.classList.remove("active");
                }
            });

            questionInput.focus();
            showToast("Loaded example question into input!", 2000);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Question Submission & Explanation
    // -------------------------------------------------------------------------
    explainForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const question = questionInput.value.trim();
        if (!question) {
            showToast("Please enter a question first.", 3000);
            questionInput.focus();
            return;
        }

        const selectedStyleRadio = document.querySelector("input[name='style']:checked");
        const style = selectedStyleRadio ? selectedStyleRadio.value : "quick_easy";

        // UI Loading Transition
        setLoading(true);

        try {
            const response = await fetch("/api/explain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, style })
            });

            let data;
            const responseText = await response.text();
            try {
                data = JSON.parse(responseText);
            } catch (parseErr) {
                data = {
                    success: false,
                    error: `Server returned non-JSON response (${response.status} ${response.statusText}): ${responseText.slice(0, 200)}`,
                    raw_details: responseText
                };
            }

            if (!response.ok || !data.success) {
                const errorMsg = data.error || `Failed to generate explanation (HTTP ${response.status}).`;
                showToast(errorMsg, 5000);
                
                if (data.code === "MISSING_API_KEY") {
                    setupAlert.classList.remove("hidden");
                }
                
                renderErrorState(errorMsg, data.code, data.raw_details);
                return;
            }

            // Save state for follow-up practice quiz
            currentQuestion = question;
            currentExplanation = data.explanation;

            // Render Markdown output
            renderExplanation(data.explanation, data.style, data.model_used);

            // Hide previous quiz if any
            if (quizCard) quizCard.classList.add("hidden");
            if (quizScoreCard) quizScoreCard.classList.add("hidden");

        } catch (err) {
            console.error("Explain error:", err);
            const errDetail = (err && err.message) ? err.message : "Network request failed";
            renderErrorState(
                `Connection Error: ${errDetail}`,
                "FETCH_ERROR",
                "Could not complete request to Flask. Please verify that 'python app.py' is running and that your network allows connections to Google AI Studio."
            );
            showToast(`Connection error: ${errDetail}`, 5000);
        } finally {
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.setAttribute("disabled", "true");
            emptyState.classList.add("hidden");
            answerView.classList.add("hidden");
            loadingState.classList.remove("hidden");

            const steps = [
                "Connecting to verified Gemma model...",
                "Analyzing conceptual structure...",
                "Drafting concise breakdown...",
                "Polishing student explanation..."
            ];
            let stepIndex = 0;
            loadingStep.textContent = steps[0];
            loadingInterval = setInterval(() => {
                stepIndex = (stepIndex + 1) % steps.length;
                loadingStep.textContent = steps[stepIndex];
            }, 2500);

        } else {
            submitBtn.removeAttribute("disabled");
            loadingState.classList.add("hidden");
            if (loadingInterval) clearInterval(loadingInterval);
        }
    }

    function renderExplanation(markdownContent, style, model) {
        answerStyleTag.textContent = formatStyleName(style);
        answerModelTag.textContent = model || "Gemma";

        explanationText.innerHTML = renderMarkdownWithMath(markdownContent);
        typesetMath(explanationText);

        answerView.classList.remove("hidden");
        emptyState.classList.add("hidden");

        if (window.innerWidth < 1024) {
            document.getElementById("outputCard").scrollIntoView({ behavior: "smooth" });
        }
    }

    function renderErrorState(message, code, rawDetails) {
        answerView.classList.remove("hidden");
        emptyState.classList.add("hidden");
        
        const detailsHtml = rawDetails ? `
            <div style="font-size: 0.8rem; font-family: monospace; color: #7f1d1d; background: #fff5f5; padding: 10px 12px; border-radius: 6px; border: 1px solid #fecaca; margin-top: 10px; word-break: break-word; white-space: pre-wrap;">
                <strong>Details:</strong>\n${escapeHtml(String(rawDetails))}
            </div>
        ` : '';

        explanationText.innerHTML = `
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; color: #991b1b;">
                <h3 style="color: #991b1b; margin-top: 0; display: flex; align-items: center; gap: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    Notice
                </h3>
                <p style="font-size: 0.95rem; margin-bottom: 12px; line-height: 1.5;">${escapeHtml(message)}</p>
                ${detailsHtml}
                <div style="font-size: 0.82rem; color: #7f1d1d; background: #fff; padding: 10px 14px; border-radius: 6px; border: 1px solid #fee2e2; margin-top: 12px;">
                    <strong>Troubleshooting Checklist:</strong>
                    <ul style="margin-top: 6px; margin-bottom: 0; padding-left: 20px; line-height: 1.5;">
                        <li>Verify <code>GEMINI_API_KEY</code> is saved in your <code>.env</code> file.</li>
                        <li>Verify your internet connection can reach Google AI Studio.</li>
                        <li>If you updated <code>.env</code>, restart the Flask server.</li>
                    </ul>
                </div>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // 4. Practice Quiz Generation & Interactive HTML Rendering
    // -------------------------------------------------------------------------
    async function fetchPracticeQuiz() {
        if (!currentQuestion && !currentExplanation) {
            showToast("Please ask and explain a question first.", 3000);
            return;
        }

        generatePracticeBtn.setAttribute("disabled", "true");
        practiceSpinner.classList.remove("hidden");
        practiceBtnText.textContent = "Gemma is crafting a 5-question quiz...";

        try {
            const response = await fetch("/api/quiz", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    original_question: currentQuestion,
                    explanation: currentExplanation
                })
            });

            let data;
            const responseText = await response.text();
            try {
                data = JSON.parse(responseText);
            } catch (parseErr) {
                data = {
                    success: false,
                    error: `Server returned non-JSON response (${response.status}): ${responseText.slice(0, 180)}`
                };
            }

            if (!response.ok || !data.success) {
                const errMsg = data.error || `Could not generate practice quiz (HTTP ${response.status}).`;
                showToast(errMsg, 5000);
                return;
            }

            currentQuiz = data.questions || [];
            if (quizModelBadge) quizModelBadge.textContent = data.model_used || "Gemma";

            // Initialize and render 1-question-at-a-time quiz
            initQuiz(currentQuiz, data.model_used);

        } catch (err) {
            console.error("Quiz generation error:", err);
            const errDetail = (err && err.message) ? err.message : "Network error";
            showToast(`Quiz error: ${errDetail}`, 5000);
        } finally {
            generatePracticeBtn.removeAttribute("disabled");
            practiceSpinner.classList.add("hidden");
            practiceBtnText.textContent = "Generate Practice Quiz";
        }
    }

    if (generatePracticeBtn) {
        generatePracticeBtn.addEventListener("click", fetchPracticeQuiz);
    }

    // -------------------------------------------------------------------------
    // 5. Practice Quiz Stepper: 1 Question At A Time
    // -------------------------------------------------------------------------
    function initQuiz(questions, modelUsed) {
        currentQuiz = questions || [];
        quizState = {
            currentIndex: 0,
            answers: {},
            checked: {},
            score: 0
        };

        if (quizModelBadge) quizModelBadge.textContent = modelUsed || "Gemma";

        // Show quiz stepper, hide score card
        if (quizProgressSection) quizProgressSection.classList.remove("hidden");
        if (quizQuestionCard) quizQuestionCard.classList.remove("hidden");
        if (quizNavActions) quizNavActions.classList.remove("hidden");
        if (quizScoreCard) quizScoreCard.classList.add("hidden");

        renderCurrentQuizQuestion();

        quizCard.classList.remove("hidden");
        quizCard.scrollIntoView({ behavior: "smooth" });
    }

    function renderCurrentQuizQuestion() {
        if (!currentQuiz || currentQuiz.length === 0) return;

        const total = currentQuiz.length;
        const idx = quizState.currentIndex;
        const q = currentQuiz[idx];
        if (!q) return;

        const isChecked = Boolean(quizState.checked[q.id]);
        const savedAnswer = quizState.answers[q.id] || "";
        const isMcq = (q.type === "mcq");

        // 1. Update Progress Header
        if (quizProgressText) {
            quizProgressText.textContent = `Question ${idx + 1} of ${total}`;
        }
        if (quizProgressBar) {
            const pct = Math.round(((idx + 1) / total) * 100);
            quizProgressBar.style.width = `${pct}%`;
        }
        if (quizTypeBadge) {
            quizTypeBadge.textContent = isMcq ? "Multiple Choice" : "Short Answer";
        }

        // 2. Render Question Prompt
        if (quizQuestionPrompt) {
            quizQuestionPrompt.innerHTML = renderMarkdownWithMath(q.question);
            typesetMath(quizQuestionPrompt);
        }

        // 3. Render Inputs
        if (quizInputContainer) {
            quizInputContainer.innerHTML = "";

            if (isMcq) {
                const group = document.createElement("div");
                group.className = "quiz-options-group";

                (q.options || []).forEach((opt, optIdx) => {
                    const optKey = (opt && typeof opt === "object" && opt.key)
                        ? String(opt.key).toUpperCase()
                        : ["A", "B", "C", "D"][optIdx] || "A";
                    const optText = extractOptionText(opt);
                    const isSelected = (savedAnswer.toUpperCase() === optKey.toUpperCase());

                    const label = document.createElement("label");
                    label.className = `quiz-option-label ${isSelected ? "selected" : ""} ${isChecked ? "disabled" : ""}`;
                    label.setAttribute("data-optkey", optKey);

                    label.innerHTML = `
                        <input type="radio" name="current_quiz_opt" value="${optKey}" ${isSelected ? "checked" : ""} ${isChecked ? "disabled" : ""}>
                        <span class="option-key">${optKey}</span>
                        <span class="option-text">${escapeHtml(optText)}</span>
                    `;

                    if (!isChecked) {
                        label.addEventListener("click", () => {
                            group.querySelectorAll(".quiz-option-label").forEach(l => l.classList.remove("selected"));
                            label.classList.add("selected");
                            const radio = label.querySelector("input[type='radio']");
                            if (radio) radio.checked = true;
                            quizState.answers[q.id] = optKey;
                        });
                    }

                    group.appendChild(label);
                });

                quizInputContainer.appendChild(group);
            } else {
                const input = document.createElement("input");
                input.type = "text";
                input.className = "quiz-text-input";
                input.id = "currentShortAnswerInput";
                input.placeholder = "Type your concise answer here (1–5 words)...";
                input.value = savedAnswer;
                input.autocomplete = "off";
                if (isChecked) input.setAttribute("disabled", "true");

                if (!isChecked) {
                    input.addEventListener("input", (e) => {
                        quizState.answers[q.id] = e.target.value.trim();
                    });
                    input.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            if (quizCheckBtn && !quizCheckBtn.classList.contains("hidden")) {
                                quizCheckBtn.click();
                            }
                        }
                    });
                }

                quizInputContainer.appendChild(input);
            }

            typesetMath(quizInputContainer);
        }

        // 4. Render Feedback Box
        if (quizFeedback) {
            if (isChecked) {
                const res = quizState.checked[q.id];
                quizFeedback.className = `quiz-feedback ${res.is_correct ? "correct" : "incorrect"}`;
                quizFeedback.innerHTML = `
                    <div class="feedback-header">
                        ${res.is_correct ? "✅ Correct! (+1 pt)" : "❌ Incorrect (0 pts)"}
                    </div>
                    <div class="feedback-answer">
                        <strong>Expected Answer:</strong> ${escapeHtml(res.display_expected || res.correct_answer)}
                    </div>
                    <div class="feedback-explanation">
                        <strong>Explanation:</strong> ${escapeHtml(res.explanation)}
                    </div>
                `;
                quizFeedback.classList.remove("hidden");
                typesetMath(quizFeedback);
            } else {
                quizFeedback.classList.add("hidden");
                quizFeedback.innerHTML = "";
            }
        }

        // 5. Update Navigation Actions
        if (quizPrevBtn) {
            if (idx > 0) {
                quizPrevBtn.classList.remove("hidden");
            } else {
                quizPrevBtn.classList.add("hidden");
            }
        }

        if (isChecked) {
            if (quizCheckBtn) quizCheckBtn.classList.add("hidden");
            if (quizNextBtn) {
                quizNextBtn.classList.remove("hidden");
                if (idx < total - 1) {
                    quizNextBtnText.textContent = "Next Question →";
                } else {
                    quizNextBtnText.textContent = "View Results 🏆";
                }
            }
        } else {
            if (quizCheckBtn) {
                quizCheckBtn.classList.remove("hidden");
                quizCheckBtn.removeAttribute("disabled");
                if (gradeSpinner) gradeSpinner.classList.add("hidden");
                if (quizCheckBtnText) quizCheckBtnText.textContent = "Check Answer";
            }
            if (quizNextBtn) quizNextBtn.classList.add("hidden");
        }
    }

    // -------------------------------------------------------------------------
    // Check Current Question Answer
    // -------------------------------------------------------------------------
    if (quizCheckBtn) {
        quizCheckBtn.addEventListener("click", async () => {
            if (!currentQuiz || currentQuiz.length === 0) return;

            const idx = quizState.currentIndex;
            const q = currentQuiz[idx];
            if (!q) return;

            // Retrieve current answer
            let userAns = quizState.answers[q.id] || "";
            if (q.type === "mcq") {
                const checkedRadio = quizInputContainer.querySelector("input[name='current_quiz_opt']:checked");
                if (checkedRadio) userAns = checkedRadio.value;
            } else {
                const textInp = quizInputContainer.querySelector(".quiz-text-input");
                if (textInp) userAns = textInp.value.trim();
            }

            if (!userAns) {
                showToast("Please provide an answer before checking.", 3000);
                if (q.type === "short_answer") {
                    const textInp = quizInputContainer.querySelector(".quiz-text-input");
                    if (textInp) textInp.focus();
                }
                return;
            }

            // Save user answer in state
            quizState.answers[q.id] = userAns;

            // Show checking loading spinner
            quizCheckBtn.setAttribute("disabled", "true");
            if (gradeSpinner) gradeSpinner.classList.remove("hidden");
            if (quizCheckBtnText) quizCheckBtnText.textContent = "Checking...";

            try {
                const response = await fetch("/api/grade-quiz", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        questions: [q],
                        answers: { [q.id]: userAns }
                    })
                });

                let data;
                const responseText = await response.text();
                try {
                    data = JSON.parse(responseText);
                } catch (parseErr) {
                    data = {
                        success: false,
                        error: `Server returned non-JSON response (${response.status}): ${responseText.slice(0, 150)}`
                    };
                }

                if (!response.ok || !data.success) {
                    showToast(data.error || `Failed to check answer (HTTP ${response.status}).`, 5000);
                    quizCheckBtn.removeAttribute("disabled");
                    if (gradeSpinner) gradeSpinner.classList.add("hidden");
                    if (quizCheckBtnText) quizCheckBtnText.textContent = "Check Answer";
                    return;
                }

                const result = (data.results && data.results.length > 0) ? data.results[0] : null;
                const isCorrect = result ? Boolean(result.is_correct) : false;
                const correctAns = result ? result.correct_answer : (q.correct_answer || "");
                const explanation = (result && result.explanation) ? result.explanation : (q.explanation || "");

                let displayExpected = correctAns;
                if (q.type === "mcq" && q.options) {
                    const matchedOpt = q.options.find(o => {
                        const k = (o && typeof o === "object" && o.key) ? o.key : "";
                        return String(k).toUpperCase() === String(correctAns).toUpperCase();
                    });
                    if (matchedOpt) {
                        displayExpected = `${matchedOpt.key}) ${extractOptionText(matchedOpt)}`;
                    }
                } else {
                    displayExpected = extractOptionText(correctAns);
                }

                // Store checked result in state
                quizState.checked[q.id] = {
                    is_correct: isCorrect,
                    correct_answer: correctAns,
                    display_expected: displayExpected,
                    explanation: explanation,
                    user_answer: userAns
                };

                // Re-render current question to update feedback and toggle to "Next Question"
                renderCurrentQuizQuestion();

            } catch (err) {
                console.error("Grading error:", err);
                const detail = (err && err.message) ? err.message : "Network error";
                showToast(`Check answer error: ${detail}`, 5000);
                quizCheckBtn.removeAttribute("disabled");
                if (gradeSpinner) gradeSpinner.classList.add("hidden");
                if (quizCheckBtnText) quizCheckBtnText.textContent = "Check Answer";
            }
        });
    }

    // -------------------------------------------------------------------------
    // Next Question Action
    // -------------------------------------------------------------------------
    if (quizNextBtn) {
        quizNextBtn.addEventListener("click", () => {
            if (!currentQuiz || currentQuiz.length === 0) return;

            if (quizState.currentIndex < currentQuiz.length - 1) {
                quizState.currentIndex++;
                renderCurrentQuizQuestion();
                quizCard.scrollIntoView({ behavior: "smooth" });
            } else {
                showQuizResults();
            }
        });
    }

    // -------------------------------------------------------------------------
    // Previous Question Action
    // -------------------------------------------------------------------------
    if (quizPrevBtn) {
        quizPrevBtn.addEventListener("click", () => {
            if (!currentQuiz || currentQuiz.length === 0) return;

            if (quizState.currentIndex > 0) {
                quizState.currentIndex--;
                renderCurrentQuizQuestion();
                quizCard.scrollIntoView({ behavior: "smooth" });
            }
        });
    }

    // -------------------------------------------------------------------------
    // 6. Results Screen & Review
    // -------------------------------------------------------------------------
    function showQuizResults() {
        if (quizProgressSection) quizProgressSection.classList.add("hidden");
        if (quizQuestionCard) quizQuestionCard.classList.add("hidden");
        if (quizNavActions) quizNavActions.classList.add("hidden");

        // Calculate score
        let totalScore = 0;
        currentQuiz.forEach(q => {
            if (quizState.checked[q.id] && quizState.checked[q.id].is_correct) {
                totalScore++;
            }
        });
        quizState.score = totalScore;

        if (scoreValue) scoreValue.textContent = totalScore;

        if (scoreHeadline && scoreMessage) {
            if (totalScore === 5) {
                scoreHeadline.textContent = "🌟 Perfect Score! (5/5)";
                scoreMessage.textContent = "Outstanding mastery! You answered every question correctly.";
            } else if (totalScore >= 3) {
                scoreHeadline.textContent = `🎉 Great Job! (${totalScore}/5)`;
                scoreMessage.textContent = "Strong conceptual grasp! Review the summary below to polish the remaining details.";
            } else {
                scoreHeadline.textContent = `Keep Going! (${totalScore}/5)`;
                scoreMessage.textContent = "Review the explanations below and hit 'Try Again' to test yourself once more!";
            }
        }

        // Render mini-summary review
        if (quizResultsSummary) {
            quizResultsSummary.innerHTML = "";
            currentQuiz.forEach((q, idx) => {
                const c = quizState.checked[q.id];
                const isCorrect = c ? Boolean(c.is_correct) : false;
                const userAns = c ? c.user_answer : (quizState.answers[q.id] || "No answer");
                const expected = c ? c.display_expected : (q.correct_answer || "");

                const item = document.createElement("div");
                item.className = "summary-item";
                item.innerHTML = `
                    <span class="summary-status-icon">${isCorrect ? "✅" : "❌"}</span>
                    <div class="summary-content">
                        <div class="summary-q-text">Q${idx + 1}: ${escapeHtml(q.question)}</div>
                        <div class="summary-ans-text">
                            <strong>Your answer:</strong> ${escapeHtml(userAns)} | 
                            <strong>Expected:</strong> ${escapeHtml(expected)}
                        </div>
                    </div>
                `;
                quizResultsSummary.appendChild(item);
            });
            typesetMath(quizResultsSummary);
        }

        if (quizScoreCard) {
            quizScoreCard.classList.remove("hidden");
            quizScoreCard.scrollIntoView({ behavior: "smooth" });
        }
    }

    // -------------------------------------------------------------------------
    // "Try Again" Button: Resets answers/feedback without calling the API
    // -------------------------------------------------------------------------
    if (tryAgainBtn) {
        tryAgainBtn.addEventListener("click", () => {
            quizState = {
                currentIndex: 0,
                answers: {},
                checked: {},
                score: 0
            };

            if (quizScoreCard) quizScoreCard.classList.add("hidden");
            if (quizProgressSection) quizProgressSection.classList.remove("hidden");
            if (quizQuestionCard) quizQuestionCard.classList.remove("hidden");
            if (quizNavActions) quizNavActions.classList.remove("hidden");

            renderCurrentQuizQuestion();

            showToast("Quiz reset! Try your answers again.", 2000);
            quizCard.scrollIntoView({ behavior: "smooth" });
        });
    }

    // "Generate New Quiz" Button
    if (newQuizBtn) {
        newQuizBtn.addEventListener("click", () => {
            fetchPracticeQuiz();
        });
    }

    // -------------------------------------------------------------------------
    // 7. Copy to Clipboard
    // -------------------------------------------------------------------------
    copyBtn.addEventListener("click", async () => {
        if (!currentExplanation) return;
        try {
            await navigator.clipboard.writeText(currentExplanation);
            copyText.textContent = "Copied!";
            showToast("Explanation copied to clipboard!", 2500);
            setTimeout(() => {
                copyText.textContent = "Copy";
            }, 2500);
        } catch (err) {
            showToast("Could not copy to clipboard.", 2000);
        }
    });

    // -------------------------------------------------------------------------
    // 8. Toast Notification Helper
    // -------------------------------------------------------------------------
    let toastTimeout = null;
    function showToast(message, duration = 3000) {
        toast.textContent = message;
        toast.classList.remove("hidden");
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.add("hidden");
        }, duration);
    }
});
