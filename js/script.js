/**
 * ネットマーケティング検定 合格トレーニング - script.js
 *
 * 問題データは js/questions.js のグローバル変数 `questions` を参照する。
 * このファイルは questions.js の内容に依存しない作りにしているため、
 * 問題を追加・変更してもこのファイルを修正する必要はない。
 */

(function () {
  "use strict";

  // =========================================================
  // 定数
  // =========================================================

  const STORAGE_KEY = "nmk_training_data_v1";
  const EXAM_DATE = new Date(2026, 10, 8); // 2026-11-08 (月は0始まり)
  const MOCK_EXAM_TOTAL = 40;
  const MOCK_BASE_COUNT = 15;
  const BASE_QUESTION_MAX_ID = 40;
  const MOCK_PASS_RATE = 0.7;
  const DIFFICULTY_LABELS = {
    1: "基礎",
    2: "標準",
    3: "本番標準",
    4: "本番やや難",
    5: "本番難問"
  };
  const ABBR_TAG_KEYWORDS = ["略語", "指標", "計算"];

  const MISTAKE_LABELS = {
    knowledge: "知らなかった",
    confused: "迷った",
    careless: "ケアレスミス"
  };

  // =========================================================
  // 問題データの前処理（重複ID対策）
  // =========================================================

  /** @type {Map<number, object>} 重複IDがあっても先に登場したものだけを採用する */
  const questionMap = new Map();
  (function buildQuestionMap() {
    const seenIds = new Set();
    (typeof questions !== "undefined" ? questions : []).forEach((q) => {
      if (seenIds.has(q.id)) {
        console.error(
          "[questions.js] 問題IDが重複しています。id=" + q.id + " はスキップされました。"
        );
        return;
      }
      seenIds.add(q.id);
      questionMap.set(q.id, q);
    });
  })();

  /** 重複を除いた問題一覧（questions.js の記述順を保持） */
  const allQuestions = Array.from(questionMap.values());

  // =========================================================
  // LocalStorage 読み書き
  // =========================================================

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyData();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return createEmptyData();
      return {
        totals: Object.assign(
          { totalAnswered: 0, totalCorrect: 0 },
          parsed.totals || {}
        ),
        questionStats: parsed.questionStats || {}
      };
    } catch (e) {
      console.error("[storage] データの読み込みに失敗しました", e);
      return createEmptyData();
    }
  }

  function createEmptyData() {
    return {
      totals: { totalAnswered: 0, totalCorrect: 0 },
      questionStats: {}
    };
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("[storage] データの保存に失敗しました", e);
    }
  }

  /** @type {{totals: {totalAnswered:number, totalCorrect:number}, questionStats: Object}} */
  let appData = loadData();

  function getStat(questionId) {
    const key = String(questionId);
    if (!appData.questionStats[key]) {
      appData.questionStats[key] = {
        attempts: 0,
        correct: 0,
        incorrect: 0,
        lastAnsweredAt: null,
        mistakes: [],
        reviewFlag: false
      };
    }
    return appData.questionStats[key];
  }

  function recordAnswer(questionId, isCorrect) {
    const stat = getStat(questionId);
    stat.attempts += 1;
    if (isCorrect) {
      stat.correct += 1;
    } else {
      stat.incorrect += 1;
    }
    stat.lastAnsweredAt = new Date().toISOString();

    appData.totals.totalAnswered += 1;
    if (isCorrect) {
      appData.totals.totalCorrect += 1;
    }
    saveData(appData);
  }

  function recordMistakeType(questionId, mistakeType) {
    const stat = getStat(questionId);
    stat.mistakes.push({ type: mistakeType, at: new Date().toISOString() });
    saveData(appData);
  }

  function toggleReviewFlag(questionId) {
    const stat = getStat(questionId);
    stat.reviewFlag = !stat.reviewFlag;
    saveData(appData);
    return stat.reviewFlag;
  }

  function getAccuracy(stat) {
    if (!stat || stat.attempts === 0) return null;
    return stat.correct / stat.attempts;
  }

  // =========================================================
  // 苦手判定・集計ロジック
  // =========================================================

  function isWeakQuestion(question) {
    const stat = appData.questionStats[String(question.id)];
    if (!stat) return false;
    const accuracy = getAccuracy(stat);
    const hasIncorrect = stat.incorrect > 0;
    const lowAccuracy = accuracy !== null && accuracy < MOCK_PASS_RATE;
    return Boolean(hasIncorrect || lowAccuracy || stat.reviewFlag);
  }

  function getWeakQuestions() {
    return allQuestions.filter(isWeakQuestion);
  }

  function isAbbrFocusQuestion(question) {
    const tags = question.tags || [];
    const hasTag = tags.some((tag) => ABBR_TAG_KEYWORDS.includes(tag));
    const isCalcSkill = question.skillType === "calculation";
    const categoryHit = /略語|指標/.test(question.category || "");
    return Boolean(hasTag || isCalcSkill || categoryHit);
  }

  /** カテゴリーごとの正答率を集計し、最も苦手なカテゴリー名を返す */
  function getWeakestCategory(targetQuestions) {
    const byCategory = {};
    targetQuestions.forEach((q) => {
      const stat = appData.questionStats[String(q.id)];
      if (!stat || stat.attempts === 0) return;
      if (!byCategory[q.category]) {
        byCategory[q.category] = { attempts: 0, incorrect: 0 };
      }
      byCategory[q.category].attempts += stat.attempts;
      byCategory[q.category].incorrect += stat.incorrect;
    });

    let worstCategory = null;
    let worstRate = -1;
    Object.keys(byCategory).forEach((category) => {
      const { attempts, incorrect } = byCategory[category];
      const rate = incorrect / attempts;
      if (rate > worstRate) {
        worstRate = rate;
        worstCategory = category;
      }
    });

    return worstRate > 0 ? worstCategory : null;
  }

  function getChapterStats() {
    const chapters = Array.from(
      new Set(allQuestions.map((q) => q.chapter))
    ).sort((a, b) => a - b);

    return chapters.map((chapter) => {
      const chapterQuestions = allQuestions.filter((q) => q.chapter === chapter);
      let attempts = 0;
      let correct = 0;
      chapterQuestions.forEach((q) => {
        const stat = appData.questionStats[String(q.id)];
        if (!stat) return;
        attempts += stat.attempts;
        correct += stat.correct;
      });
      return {
        chapter,
        attempts,
        accuracy: attempts > 0 ? correct / attempts : null
      };
    });
  }

  // =========================================================
  // 配列ユーティリティ
  // =========================================================

  function shuffle(array) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function pickRandomN(array, n) {
    return shuffle(array).slice(0, Math.min(n, array.length));
  }

  function dedupeById(array) {
    const seen = new Set();
    const result = [];
    array.forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      result.push(item);
    });
    return result;
  }

  // =========================================================
  // 出題セット選定ロジック
  // =========================================================

  function selectRandomQuestions(count) {
    return pickRandomN(allQuestions, count);
  }

  function selectWeakReviewQuestions() {
    const weakQuestions = getWeakQuestions();
    const withScore = weakQuestions.map((q) => {
      const stat = appData.questionStats[String(q.id)];
      const accuracy = getAccuracy(stat);
      const priority = accuracy === null ? 0.5 : accuracy;
      return { question: q, sortKey: priority + Math.random() * 0.3 };
    });
    withScore.sort((a, b) => a.sortKey - b.sortKey);
    return withScore.map((item) => item.question);
  }

  function selectAbbrFocusQuestions(count) {
    const matched = allQuestions.filter(isAbbrFocusQuestion);
    const others = allQuestions.filter((q) => !isAbbrFocusQuestion(q));
    const pool = shuffle(matched).concat(shuffle(others));
    return dedupeById(pool).slice(0, Math.min(count, pool.length));
  }

  /**
   * 章ごとの問題数の比率をプール全体に合わせて割り当て（最大剰余法）、
   * 章の中はランダムに選ぶ。特定の章に偏らないようにするため。
   */
  function pickProportionalByChapter(pool, count) {
    const total = pool.length;
    const target = Math.min(count, total);
    const groups = new Map();
    shuffle(pool).forEach((q) => {
      if (!groups.has(q.chapter)) groups.set(q.chapter, []);
      groups.get(q.chapter).push(q);
    });

    const entries = Array.from(groups.values()).map((queue) => {
      const exact = (target * queue.length) / total;
      return { queue, quota: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });

    let remaining = target - entries.reduce((sum, e) => sum + e.quota, 0);
    entries
      .slice()
      .sort((a, b) => b.remainder - a.remainder)
      .forEach((e) => {
        if (remaining > 0 && e.quota < e.queue.length) {
          e.quota += 1;
          remaining -= 1;
        }
      });

    const result = [];
    entries.forEach(({ queue, quota }) => {
      for (let i = 0; i < quota; i++) result.push(queue.pop());
    });
    return result;
  }

  /**
   * 模擬試験：基礎Q1〜Q40から15問＋本番Q41以降から25問を選ぶ。
   * 2つのプールは重ならないため、同一問題は重複しない。
   */
  function selectMockExamQuestions() {
    const baseQuestions = allQuestions.filter((q) => q.id <= BASE_QUESTION_MAX_ID);
    const advancedQuestions = allQuestions.filter((q) => q.id > BASE_QUESTION_MAX_ID);

    const baseCount = Math.min(MOCK_BASE_COUNT, baseQuestions.length);
    const advancedCount = Math.min(MOCK_EXAM_TOTAL - baseCount, advancedQuestions.length);

    let picked = pickProportionalByChapter(baseQuestions, baseCount).concat(
      pickProportionalByChapter(advancedQuestions, advancedCount)
    );

    if (picked.length < MOCK_EXAM_TOTAL) {
      const usedIds = new Set(picked.map((q) => q.id));
      const leftover = allQuestions.filter((q) => !usedIds.has(q.id));
      picked = picked.concat(pickProportionalByChapter(leftover, MOCK_EXAM_TOTAL - picked.length));
    }

    return shuffle(dedupeById(picked)).slice(0, MOCK_EXAM_TOTAL);
  }

  // =========================================================
  // 画面切り替え
  // =========================================================

  const screens = {
    home: document.getElementById("screen-home"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result")
  };

  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].hidden = key !== name;
    });
    window.scrollTo(0, 0);
  }

  // =========================================================
  // ホーム画面の表示
  // =========================================================

  function renderExamCountdown() {
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.ceil((EXAM_DATE - todayMidnight) / (1000 * 60 * 60 * 24));
    const el = document.getElementById("exam-countdown");

    if (diffDays > 0) {
      el.textContent = "試験まで あと " + diffDays + " 日";
    } else if (diffDays === 0) {
      el.textContent = "試験は本日です";
    } else {
      el.textContent = "試験日が終了しました";
    }
  }

  function renderStats() {
    const totals = appData.totals;
    document.getElementById("stat-total-answered").textContent = totals.totalAnswered;

    const accuracyEl = document.getElementById("stat-accuracy");
    accuracyEl.textContent =
      totals.totalAnswered > 0
        ? Math.round((totals.totalCorrect / totals.totalAnswered) * 100) + "%"
        : "-";

    const weakQuestions = getWeakQuestions();
    document.getElementById("stat-weak-count").textContent = weakQuestions.length;

    const weakCategory = getWeakestCategory(allQuestions);
    document.getElementById("stat-weak-category").textContent = weakCategory || "-";
  }

  function renderChapterList() {
    const listEl = document.getElementById("chapter-list");
    listEl.innerHTML = "";

    getChapterStats().forEach(({ chapter, accuracy }) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.className = "chapter-name";
      nameSpan.textContent = "第" + chapter + "章";

      const scoreSpan = document.createElement("span");
      if (accuracy === null) {
        scoreSpan.className = "chapter-score chapter-score--empty";
        scoreSpan.textContent = "未学習";
      } else {
        scoreSpan.className = "chapter-score";
        scoreSpan.textContent = Math.round(accuracy * 100) + "%";
      }

      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      listEl.appendChild(li);
    });
  }

  function renderMockButtonState() {
    const mockButton = document.getElementById("mode-mock");
    const mockNote = document.getElementById("mock-note");

    if (allQuestions.length < MOCK_EXAM_TOTAL) {
      mockButton.disabled = true;
      mockNote.hidden = false;
      mockNote.textContent =
        "模擬試験には40問以上の登録が必要です（現在" + allQuestions.length + "問）";
    } else {
      mockButton.disabled = false;
      mockNote.hidden = true;
    }
  }

  function showHomeMessage(text) {
    const el = document.getElementById("home-message");
    el.hidden = false;
    el.textContent = text;
  }

  function clearHomeMessage() {
    const el = document.getElementById("home-message");
    el.hidden = true;
    el.textContent = "";
  }

  function renderHome() {
    clearHomeMessage();
    renderExamCountdown();
    renderStats();
    renderChapterList();
    renderMockButtonState();
  }

  // =========================================================
  // クイズの進行管理
  // =========================================================

  /**
   * @type {{
   *   mode: string,
   *   questions: object[],
   *   index: number,
   *   answers: Array<{questionId:number, isCorrect:boolean}>,
   *   answeredCurrent: boolean
   * } | null}
   */
  let currentQuiz = null;

  function startQuiz(mode) {
    let selected;

    switch (mode) {
      case "five":
        selected = selectRandomQuestions(5);
        break;
      case "ten":
        selected = selectRandomQuestions(10);
        break;
      case "weak":
        selected = selectWeakReviewQuestions();
        if (selected.length === 0) {
          showHomeMessage("復習対象の問題はまだありません。演習を進めて間違いを記録しましょう。");
          return;
        }
        break;
      case "abbr":
        selected = selectAbbrFocusQuestions(10);
        if (selected.length === 0) {
          showHomeMessage("略語・指標に関する問題がまだ登録されていません。");
          return;
        }
        break;
      case "mock":
        if (allQuestions.length < MOCK_EXAM_TOTAL) {
          showHomeMessage(
            "模擬試験には40問以上の登録が必要です（現在" + allQuestions.length + "問）"
          );
          return;
        }
        selected = selectMockExamQuestions();
        break;
      default:
        return;
    }

    clearHomeMessage();
    currentQuiz = {
      mode: mode,
      questions: selected,
      index: 0,
      answers: [],
      answeredCurrent: false
    };

    showScreen("quiz");
    renderQuestion();
  }

  function startReviewOfMistakes() {
    if (!currentQuiz) return;
    const wrongIds = new Set(
      currentQuiz.answers.filter((a) => !a.isCorrect).map((a) => a.questionId)
    );
    const wrongQuestions = allQuestions.filter((q) => wrongIds.has(q.id));

    if (wrongQuestions.length === 0) {
      showScreen("home");
      renderHome();
      return;
    }

    currentQuiz = {
      mode: "review-mistakes",
      questions: shuffle(wrongQuestions),
      index: 0,
      answers: [],
      answeredCurrent: false
    };

    showScreen("quiz");
    renderQuestion();
  }

  function getCurrentQuestion() {
    return currentQuiz.questions[currentQuiz.index];
  }

  function renderQuestion() {
    const question = getCurrentQuestion();
    const total = currentQuiz.questions.length;

    document.getElementById("quiz-progress").textContent =
      (currentQuiz.index + 1) + " / " + total;
    document.getElementById("quiz-chapter").textContent = "第" + question.chapter + "章";
    document.getElementById("quiz-category").textContent = question.category;
    const difficultyEl = document.getElementById("quiz-difficulty");
    difficultyEl.textContent = DIFFICULTY_LABELS[question.difficulty] || "";
    difficultyEl.classList.toggle("is-advanced", question.difficulty >= 3);
    document.getElementById("quiz-question").textContent = question.question;

    renderChoices(question, null);
    hideFeedback();
    renderReviewToggleButton(question);

    document.getElementById("next-question").hidden = true;
    currentQuiz.answeredCurrent = false;
  }

  function renderChoices(question, selectedIndex) {
    const choicesEl = document.getElementById("quiz-choices");
    choicesEl.innerHTML = "";
    const labels = ["A", "B", "C", "D"];

    question.choices.forEach((choiceText, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.dataset.index = String(index);

      const labelSpan = document.createElement("span");
      labelSpan.className = "choice-label";
      labelSpan.textContent = labels[index];

      const textSpan = document.createElement("span");
      textSpan.className = "choice-text";
      textSpan.textContent = choiceText;

      btn.appendChild(labelSpan);
      btn.appendChild(textSpan);

      if (selectedIndex !== null) {
        btn.classList.add("is-disabled");
        if (index === question.answer) {
          btn.classList.add("is-correct");
        } else if (index === selectedIndex) {
          btn.classList.add("is-incorrect");
        }
      } else {
        btn.addEventListener("click", () => handleChoiceClick(index));
      }

      choicesEl.appendChild(btn);
    });
  }

  function handleChoiceClick(selectedIndex) {
    if (currentQuiz.answeredCurrent) return;
    currentQuiz.answeredCurrent = true;

    const question = getCurrentQuestion();
    const isCorrect = selectedIndex === question.answer;

    recordAnswer(question.id, isCorrect);
    currentQuiz.answers.push({ questionId: question.id, isCorrect });

    renderChoices(question, selectedIndex);
    renderFeedback(question, isCorrect);

    document.getElementById("next-question").hidden = false;
  }

  function renderFeedback(question, isCorrect) {
    const feedbackEl = document.getElementById("quiz-feedback");
    feedbackEl.hidden = false;

    const resultEl = document.getElementById("feedback-result");
    resultEl.textContent = isCorrect ? "○ 正解！" : "× 不正解";
    resultEl.className = "feedback-result " + (isCorrect ? "is-correct" : "is-incorrect");

    const labels = ["A", "B", "C", "D"];
    document.getElementById("feedback-correct-answer").textContent =
      "正解：" + labels[question.answer];
    document.getElementById("feedback-explanation").textContent =
      "解説：" + question.explanation;

    const mistakeSection = document.getElementById("mistake-type-section");
    mistakeSection.hidden = isCorrect;
    if (!isCorrect) {
      mistakeSection.querySelectorAll(".mistake-btn").forEach((btn) => {
        btn.classList.remove("is-selected");
      });
    }
  }

  function hideFeedback() {
    document.getElementById("quiz-feedback").hidden = true;
    document.getElementById("mistake-type-section").hidden = true;
  }

  function handleMistakeTypeClick(mistakeType, buttonEl) {
    const question = getCurrentQuestion();
    recordMistakeType(question.id, mistakeType);

    document.querySelectorAll(".mistake-btn").forEach((btn) => {
      btn.classList.remove("is-selected");
    });
    buttonEl.classList.add("is-selected");
  }

  function renderReviewToggleButton(question) {
    const stat = appData.questionStats[String(question.id)];
    const isFlagged = Boolean(stat && stat.reviewFlag);
    const btn = document.getElementById("review-toggle");
    btn.textContent = isFlagged ? "♥ 復習対象に登録中" : "♡ あとで復習";
    btn.classList.toggle("is-active", isFlagged);
  }

  function handleReviewToggle() {
    const question = getCurrentQuestion();
    toggleReviewFlag(question.id);
    renderReviewToggleButton(question);
  }

  function handleNextQuestion() {
    if (currentQuiz.index + 1 < currentQuiz.questions.length) {
      currentQuiz.index += 1;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  // =========================================================
  // 結果画面
  // =========================================================

  function finishQuiz() {
    showScreen("result");
    renderResult();
  }

  function renderResult() {
    const total = currentQuiz.answers.length;
    const correctCount = currentQuiz.answers.filter((a) => a.isCorrect).length;
    const wrongCount = total - correctCount;
    const accuracy = total > 0 ? correctCount / total : 0;

    document.getElementById("result-score").textContent =
      total + "問中 " + correctCount + "問正解";
    document.getElementById("result-accuracy").textContent =
      "正答率 " + Math.round(accuracy * 100) + "%";

    const passEl = document.getElementById("result-pass");
    if (currentQuiz.mode === "mock") {
      passEl.hidden = false;
      if (accuracy >= MOCK_PASS_RATE) {
        passEl.textContent = "合格圏";
        passEl.className = "result-pass is-pass";
      } else {
        const neededCorrect = Math.ceil(total * MOCK_PASS_RATE) - correctCount;
        passEl.textContent = "要復習（あと" + Math.max(neededCorrect, 1) + "問で70%）";
        passEl.className = "result-pass is-fail";
      }
    } else {
      passEl.hidden = true;
    }

    document.getElementById("result-wrong-count").textContent = wrongCount + "問";

    const answeredQuestionIds = currentQuiz.questions.map((q) => q.id);
    const reviewFlaggedCount = answeredQuestionIds.filter((id) => {
      const stat = appData.questionStats[String(id)];
      return Boolean(stat && stat.reviewFlag);
    }).length;
    document.getElementById("result-review-count").textContent = reviewFlaggedCount + "問";

    const weakCategory = getWeakestCategory(currentQuiz.questions);
    document.getElementById("result-weak-category").textContent = weakCategory || "-";

    document.getElementById("result-review-mistakes").hidden = wrongCount === 0;
  }

  // =========================================================
  // イベント登録
  // =========================================================

  function initEventListeners() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        startQuiz(btn.dataset.mode);
      });
    });

    document.getElementById("quiz-exit").addEventListener("click", () => {
      currentQuiz = null;
      showScreen("home");
      renderHome();
    });

    document.getElementById("review-toggle").addEventListener("click", handleReviewToggle);
    document.getElementById("next-question").addEventListener("click", handleNextQuestion);

    document.querySelectorAll(".mistake-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleMistakeTypeClick(btn.dataset.mistake, btn);
      });
    });

    document.getElementById("result-review-mistakes").addEventListener("click", startReviewOfMistakes);
    document.getElementById("result-home").addEventListener("click", () => {
      currentQuiz = null;
      showScreen("home");
      renderHome();
    });
  }

  // =========================================================
  // 初期化
  // =========================================================

  document.addEventListener("DOMContentLoaded", () => {
    initEventListeners();
    renderHome();
    showScreen("home");
  });
})();
