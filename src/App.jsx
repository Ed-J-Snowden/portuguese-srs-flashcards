import React, { useEffect, useMemo, useState } from "react";
import { RAW_INITIAL_CARDS } from "./data/initialCards";

const STORAGE_KEY = "pt_srs_flashcards_v17_full_2761_voice_fix";
const TRANSLATION_NEEDED = "[translation needed]";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TEN_MINUTES_IN_DAYS = 10 / (24 * 60);
const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

function normaliseKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `card_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function makeCard(pt, en, example = "", id = makeId()) {
  return {
    id,
    pt: String(pt || "").trim(),
    en: String(en || "").trim(),
    example: String(example || "").trim(),
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    due: Date.now(),
    lastReviewed: null,
    correct: 0,
    wrong: 0,
  };
}

const sampleCards = RAW_INITIAL_CARDS.map(([pt, en, example = ""], index) =>
  makeCard(pt, en, example, String(index + 1))
);

function lookupTranslation(pt) {
  const found = RAW_INITIAL_CARDS.find(([rawPt]) => normaliseKey(rawPt) === normaliseKey(pt));
  return found ? found[1] : TRANSLATION_NEEDED;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function calculateNext(card, quality) {
  let ease = Number.isFinite(card.ease) ? card.ease : 2.5;
  let repetitions = Number.isFinite(card.repetitions) ? card.repetitions : 0;
  let interval = Number.isFinite(card.interval) ? card.interval : 0;

  if (quality < 3) {
    repetitions = 0;
    interval = TEN_MINUTES_IN_DAYS;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    if (repetitions === 0) interval = quality === 5 ? 1 : 0.5;
    else if (repetitions === 1) interval = quality === 5 ? 4 : quality === 4 ? 2 : 1;
    else interval = Math.max(1, interval * ease * (quality === 5 ? 1.35 : quality === 3 ? 0.65 : 1));
    repetitions += 1;
    ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }

  return {
    ...card,
    ease,
    repetitions,
    interval,
    due: Date.now() + interval * MS_PER_DAY,
    lastReviewed: Date.now(),
    correct: (card.correct ?? 0) + (quality >= 3 ? 1 : 0),
    wrong: (card.wrong ?? 0) + (quality < 3 ? 1 : 0),
  };
}

function splitDelimitedLine(line) {
  return line.includes(TAB) ? line.split(TAB) : line.split(",");
}

function parseImport(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  try {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) {
      return json
        .map((item) => {
          const pt = item.pt || item.portuguese || "";
          const en = item.en || item.english || lookupTranslation(pt);
          return makeCard(pt, en, item.example || "");
        })
        .filter((card) => card.pt && card.en);
    }
  } catch (_) {
    // Not JSON; parse as raw lines, CSV, or TSV.
  }

  return trimmed
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const hasDelimiter = line.includes(TAB) || line.includes(",");
      if (!hasDelimiter) return makeCard(line, lookupTranslation(line), "");
      const parts = splitDelimitedLine(line);
      const pt = (parts[0] || "").trim();
      const en = (parts[1] || lookupTranslation(pt)).trim();
      const example = (parts[2] || "").trim();
      return makeCard(pt, en, example);
    })
    .filter((card) => card.pt && card.en);
}

function mergeCardsWithoutDuplicates(existingCards, importedCards) {
  const seen = new Set(existingCards.map((card) => normaliseKey(card.pt)));
  const unique = [];
  for (const card of importedCards) {
    const key = normaliseKey(card.pt);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(card);
    }
  }
  return [...unique, ...existingCards];
}

function updateCardById(cards, cardId, updates) {
  return cards.map((card) =>
    card.id === cardId
      ? {
          ...card,
          pt: String(updates.pt ?? card.pt).trim(),
          en: String(updates.en ?? card.en).trim(),
          example: String(updates.example ?? card.example ?? "").trim(),
        }
      : card
  );
}

function deleteCardById(cards, cardId) {
  return cards.filter((card) => card.id !== cardId);
}


function filterCards(cards, query) {
  const q = normaliseKey(query);
  if (!q) return cards;
  return cards.filter((card) => {
    const haystack = [card.pt, card.en, card.example].map(normaliseKey).join(" ");
    return haystack.includes(q);
  });
}

function runSelfTests() {
  const csv = parseImport(["olá,hello", "bom dia,good morning"].join(NEWLINE));
  console.assert(csv.length === 2, "CSV import should parse two cards");
  console.assert(csv[0].pt === "olá" && csv[0].en === "hello", "CSV import should preserve Portuguese and English fields");

  const tsv = parseImport(["vir ao de cima", "to become apparent", "Example sentence"].join(TAB));
  console.assert(tsv.length === 1, "TSV import should parse one card");
  console.assert(tsv[0].example === "Example sentence", "TSV import should parse the optional example field");

  const json = parseImport('[{"pt":"vocês vêm","en":"you come"},{"portuguese":"vocês veem","english":"you see"}]');
  console.assert(json.length === 2, "JSON import should support pt/en and portuguese/english keys");

  const raw = parseImport(["o peito", "o calcanhar"].join(NEWLINE));
  console.assert(raw.length === 2, "Raw Portuguese-line import should parse two cards");
  console.assert(raw[0].en === "the chest / breast", "Raw Portuguese-line import should use built-in translations when available");

  const unknown = parseImport("palavra inventada sem tradução");
  console.assert(unknown.length === 1, "Unknown raw import should still create a card");
  console.assert(unknown[0].en === TRANSLATION_NEEDED, "Unknown raw import should be marked as translation needed");

  const merged = mergeCardsWithoutDuplicates([makeCard("o peito", "the chest")], parseImport(["o peito", "o calcanhar"].join(NEWLINE)));
  console.assert(merged.length === 2, "Merge should skip duplicate Portuguese prompts");

  const original = makeCard("antigo", "old", "old example", "edit-test");
  original.correct = 3;
  const edited = updateCardById([original], "edit-test", { pt: "novo", en: "new", example: "new example" });
  console.assert(edited[0].pt === "novo" && edited[0].en === "new", "Editing should update Portuguese and English fields");
  console.assert(edited[0].example === "new example", "Editing should update the example field");
  console.assert(edited[0].correct === 3, "Editing should preserve SRS progress and statistics");

  const deleted = deleteCardById([makeCard("a", "a", "", "delete-me"), makeCard("b", "b", "", "keep-me")], "delete-me");
  console.assert(deleted.length === 1 && deleted[0].id === "keep-me", "Deleting should remove only the selected card");


  const filteredByPt = filterCards([makeCard("o peito", "the chest"), makeCard("o calcanhar", "the heel")], "peito");
  console.assert(filteredByPt.length === 1 && filteredByPt[0].pt === "o peito", "Search should filter by Portuguese text");

  const filteredByEn = filterCards([makeCard("o peito", "the chest"), makeCard("o calcanhar", "the heel")], "heel");
  console.assert(filteredByEn.length === 1 && filteredByEn[0].pt === "o calcanhar", "Search should filter by English text");

  const filteredByExample = filterCards([makeCard("teste", "test", "example sentence")], "sentence");
  console.assert(filteredByExample.length === 1, "Search should filter by example text");

  const filteredAccent = filterCards([makeCard("a psicóloga", "the psychologist")], "PSICÓLOGA");
  console.assert(filteredAccent.length === 1, "Search should be case-insensitive and preserve accented matching");

  console.assert(Array.isArray(RAW_INITIAL_CARDS), "Initial deck should be an array");
  console.assert(RAW_INITIAL_CARDS.every((row) => Array.isArray(row) && row.length >= 2), "Each initial deck row should be [pt, en] or [pt, en, example]");
  console.assert(sampleCards.length === RAW_INITIAL_CARDS.length, "Initial deck should be converted into sample cards");

  const wrong = calculateNext(makeCard("teste", "test"), 0);
  console.assert(wrong.wrong === 1 && wrong.correct === 0, "Wrong review should increase wrong count only");
  console.assert(wrong.repetitions === 0, "Wrong review should reset repetitions");

  const good = calculateNext(makeCard("teste", "test"), 4);
  console.assert(good.correct === 1 && good.wrong === 0, "Good review should increase correct count only");
  console.assert(good.repetitions === 1 && good.interval === 0.5, "First good review should schedule about half a day later");
}

runSelfTests();

function Button({ children, onClick, variant = "primary", className = "", type = "button", disabled = false }) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-500",
    success: "bg-emerald-600 text-white hover:bg-emerald-500",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles[variant] || styles.primary} ${className}`}>
      {children}
    </button>
  );
}

function Panel({ children, className = "" }) {
  return <section className={`rounded-2xl border bg-white shadow-sm ${className}`}>{children}</section>;
}

function TextInput(props) {
  return <input {...props} className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 ${props.className || ""}`} />;
}

function TextArea(props) {
  return <textarea {...props} className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 ${props.className || ""}`} />;
}

function StatCard({ value, label }) {
  return (
    <Panel className="p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </Panel>
  );
}

function CardRow({ card, isEditing, isConfirmingDelete, editPt, editEn, editExample, onEditPt, onEditEn, onEditExample, onStartEdit, onSave, onCancel, onRequestDelete, onConfirmDelete, onCancelDelete }) {
  if (isEditing) {
    return (
      <tr className="border-b last:border-0">
        <td className="py-2 pr-3 align-top"><TextInput value={editPt} onChange={(e) => onEditPt(e.target.value)} /></td>
        <td className="py-2 pr-3 align-top">
          <TextInput value={editEn} onChange={(e) => onEditEn(e.target.value)} />
          <TextInput className="mt-2" placeholder="Example sentence" value={editExample} onChange={(e) => onEditExample(e.target.value)} />
        </td>
        <td className="py-2 pr-3 align-top">{formatDateTime(card.due)}</td>
        <td className="py-2 pr-3 align-top">{card.interval ? `${card.interval.toFixed(2)}d` : "new"}</td>
        <td className="py-2 pr-3 align-top">{card.correct ?? 0} / {card.wrong ?? 0}</td>
        <td className="py-2 pr-3 align-top"><div className="flex flex-wrap gap-2"><Button variant="success" onClick={onSave}>Save</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div></td>
      </tr>
    );
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 font-medium">{card.pt}</td>
      <td className={`py-2 pr-3 ${card.en === TRANSLATION_NEEDED ? "font-medium text-amber-700" : "text-slate-600"}`}>
        <div>{card.en}</div>
        {card.example && <div className="mt-1 text-xs italic text-slate-400">{card.example}</div>}
      </td>
      <td className="py-2 pr-3">{formatDateTime(card.due)}</td>
      <td className="py-2 pr-3">{card.interval ? `${card.interval.toFixed(2)}d` : "new"}</td>
      <td className="py-2 pr-3">{card.correct ?? 0} / {card.wrong ?? 0}</td>
      <td className="py-2 pr-3">
        {isConfirmingDelete ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => onConfirmDelete(card)}>Confirm</Button>
            <Button variant="outline" onClick={onCancelDelete}>Cancel</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onStartEdit(card)}>Edit</Button>
            <Button variant="danger" onClick={() => onRequestDelete(card)}>Delete</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function PortugueseSRSFlashcards() {
  const [cards, setCards] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : sampleCards;
    } catch {
      return sampleCards;
    }
  });
  const [showAnswer, setShowAnswer] = useState(false);
  const [frontMode, setFrontMode] = useState("en");
  const [importText, setImportText] = useState(["o peito", "o calcanhar", "Gelado de baunilha", "vir ao de cima", "palavra nova"].join(NEWLINE));
  const [newPt, setNewPt] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newExample, setNewExample] = useState("");
  const [message, setMessage] = useState("");
  const [voicesReady, setVoicesReady] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editPt, setEditPt] = useState("");
  const [editEn, setEditEn] = useState("");
  const [editExample, setEditExample] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    } catch {
      setMessage("Could not save progress in this browser.");
    }
  }, [cards]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) setVoicesReady(true);
    }

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const now = Date.now();
  const dueCards = useMemo(() => cards.filter((card) => (card.due ?? 0) <= now), [cards, now]);
  const current = useMemo(() => {
    if (!cards.length) return null;
    const ordered = [...cards].sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
    return dueCards[0] || ordered[0];
  }, [cards, dueCards]);
  const sortedCards = useMemo(() => [...cards].sort((a, b) => (a.due ?? 0) - (b.due ?? 0)), [cards]);
  const visibleCards = useMemo(() => filterCards(sortedCards, searchQuery), [sortedCards, searchQuery]);
  const nextDue = sortedCards[0]?.due ?? null;
  const learningCount = cards.filter((card) => (card.repetitions ?? 0) === 0).length;
  const masteredCount = cards.filter((card) => (card.repetitions ?? 0) >= 4).length;
  const translationNeededCount = cards.filter((card) => card.en === TRANSLATION_NEEDED).length;
  const accuracy = useMemo(() => {
    const correct = cards.reduce((sum, card) => sum + (card.correct ?? 0), 0);
    const wrong = cards.reduce((sum, card) => sum + (card.wrong ?? 0), 0);
    return correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
  }, [cards]);

  function getPortugueseVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((voice) => voice.lang === "pt-PT") ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("pt-pt")) ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("pt")) ||
      null
    );
  }

  function speak(text) {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) {
      setMessage("Speech is not available in this browser.");
      return;
    }

    const run = () => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "pt-PT";
      utterance.rate = 0.85;

      const voice = getPortugueseVoice();
      if (voice) utterance.voice = voice;

      utterance.onerror = () => setMessage("Speech failed. Try again or check your browser voice settings.");
      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      setTimeout(run, 250);
    } else {
      run();
    }
  }

  function revealAnswer() {
    const nextShowAnswer = !showAnswer;
    setShowAnswer(nextShowAnswer);
    if (nextShowAnswer && current && frontMode === "en") {
      speak(current.pt);
    }
  }

  function review(quality) {
    if (!current) return;
    setCards((prev) => prev.map((card) => (card.id === current.id ? calculateNext(card, quality) : card)));
    setShowAnswer(false);
    setMessage(quality < 3 ? "Marked wrong. This card will return soon." : "Review saved. Next interval updated.");
  }

  function addCard() {
    if (!newPt.trim() || !newEn.trim()) {
      setMessage("Add both Portuguese and English before saving a card.");
      return;
    }

    setCards((prev) => mergeCardsWithoutDuplicates(prev, [makeCard(newPt, newEn, newExample)]));
    setNewPt("");
    setNewEn("");
    setNewExample("");
    setMessage("Card added. Duplicates are skipped automatically.");
  }

  function importCards() {
    const imported = parseImport(importText);
    if (!imported.length) {
      setMessage("No valid cards found. Use raw Portuguese lines, CSV, TSV, or JSON.");
      return;
    }
    setCards((prev) => mergeCardsWithoutDuplicates(prev, imported));
    setMessage(`${imported.length} card${imported.length === 1 ? "" : "s"} processed. Existing duplicates are skipped automatically.`);
  }

  function exportCards() {
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "portuguese-srs-flashcards.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Export file created.");
  }

  function startEditing(card) {
    setDeleteConfirmId(null);
    setEditingId(card.id);
    setEditPt(card.pt);
    setEditEn(card.en);
    setEditExample(card.example || "");
    setMessage(`Editing: ${card.pt}`);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditPt("");
    setEditEn("");
    setEditExample("");
    setMessage("Edit cancelled.");
  }

  function saveEditing() {
    if (!editingId) return;
    if (!editPt.trim() || !editEn.trim()) {
      setMessage("Portuguese and English fields cannot be empty.");
      return;
    }
    const duplicate = cards.some((card) => card.id !== editingId && normaliseKey(card.pt) === normaliseKey(editPt));
    if (duplicate) {
      setMessage("Another card already uses this Portuguese prompt.");
      return;
    }
    setCards((prev) => updateCardById(prev, editingId, { pt: editPt, en: editEn, example: editExample }));
    setEditingId(null);
    setEditPt("");
    setEditEn("");
    setEditExample("");
    setMessage("Card updated. SRS progress was preserved.");
  }

  function requestDeleteCard(card) {
    setEditingId(null);
    setDeleteConfirmId(card.id);
    setMessage(`Confirm deletion: ${card.pt}`);
  }

  function cancelDeleteCard() {
    setDeleteConfirmId(null);
    setMessage("Delete cancelled.");
  }

  function confirmDeleteCard(card) {
    setCards((prev) => deleteCardById(prev, card.id));
    setDeleteConfirmId(null);
    setMessage(`Deleted: ${card.pt}`);
  }

  function resetProgress() {
    setCards((prev) => prev.map((card) => ({ ...card, ease: 2.5, interval: 0, repetitions: 0, due: Date.now(), lastReviewed: null, correct: 0, wrong: 0 })));
    setShowAnswer(false);
    setMessage("Progress reset. Cards are due now.");
  }

  function restoreSampleDeck() {
    setCards(sampleCards.map((card) => ({ ...card, due: Date.now() })));
    setShowAnswer(false);
    setMessage("Sample deck restored.");
  }

  function shuffleCards() {
    setCards((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
    setMessage("Cards shuffled.");
  }

  const frontText = current ? (frontMode === "pt" ? current.pt : current.en) : "";
  const backText = current ? (frontMode === "pt" ? current.en : current.pt) : "";
  const reviewCount = current ? (current.correct ?? 0) + (current.wrong ?? 0) : 0;

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Portuguese SRS Flashcards</h1>
            <p className="mt-2 text-slate-600">PT-PT flashcards with spaced repetition, editing, imports and browser pronunciation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFrontMode(frontMode === "pt" ? "en" : "pt")}>↔ Front: {frontMode === "pt" ? "Portuguese" : "English"}</Button>
            <Button variant="outline" onClick={shuffleCards}>⤨ Shuffle</Button>
            <Button variant="outline" onClick={exportCards}>↓ Export</Button>
          </div>
        </header>

        {message && <div className="rounded-2xl border bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{message}</div>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <StatCard value={cards.length} label="Total cards" />
          <StatCard value={dueCards.length} label="Due now" />
          <StatCard value={learningCount} label="New / learning" />
          <StatCard value={masteredCount} label="Mastered" />
          <StatCard value={`${accuracy}%`} label="Accuracy" />
          <StatCard value={translationNeededCount} label="Need translation" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Panel className="p-6 md:p-8">
            {!current ? (
              <div className="py-20 text-center"><h2 className="text-2xl font-semibold">No cards yet</h2><p className="mt-2 text-slate-500">Add or import cards to begin.</p></div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between gap-3 text-sm text-slate-500"><span>Next due: {formatDateTime(nextDue)}</span><span>Reviewed: {reviewCount} times</span></div>
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border bg-white p-6 text-center shadow-sm md:p-10">
                  <div className="mb-4 text-sm uppercase tracking-widest text-slate-400">{showAnswer ? "Answer" : "Prompt"}</div>
                  <div className="text-3xl font-bold leading-tight md:text-5xl">{showAnswer ? backText : frontText}</div>
                  {showAnswer && current.example && <div className="mt-6 max-w-2xl text-lg italic text-slate-600">“{current.example}”</div>}
                  <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <Button variant="outline" onClick={() => speak(current.pt)}>🔊 Read Portuguese{voicesReady ? "" : ""}</Button>
                    <Button onClick={revealAnswer}>{showAnswer ? "Hide answer" : "Show answer"}</Button>
                  </div>
                </div>
                {showAnswer && (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Button className="h-14" variant="danger" onClick={() => review(0)}>✕ Wrong</Button>
                    <Button className="h-14" variant="outline" onClick={() => review(3)}>Hard</Button>
                    <Button className="h-14" variant="success" onClick={() => review(4)}>✓ Good</Button>
                    <Button className="h-14" variant="secondary" onClick={() => review(5)}>Easy</Button>
                  </div>
                )}
                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <div className="rounded-xl bg-slate-100 p-3"><b>Interval</b><div>{current.interval ? `${current.interval.toFixed(2)} days` : "new"}</div></div>
                  <div className="rounded-xl bg-slate-100 p-3"><b>Ease</b><div>{(current.ease ?? 2.5).toFixed(2)}</div></div>
                  <div className="rounded-xl bg-slate-100 p-3"><b>Correct</b><div>{current.correct ?? 0}</div></div>
                  <div className="rounded-xl bg-slate-100 p-3"><b>Wrong</b><div>{current.wrong ?? 0}</div></div>
                </div>
              </div>
            )}
          </Panel>

          <aside className="space-y-6">
            <Panel className="space-y-3 p-5">
              <h2 className="text-xl font-semibold">Add a card</h2>
              <TextInput placeholder="Portuguese word / phrase" value={newPt} onChange={(e) => setNewPt(e.target.value)} />
              <TextInput placeholder="English translation" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
              <TextInput placeholder="Example sentence, optional" value={newExample} onChange={(e) => setNewExample(e.target.value)} />
              <Button className="w-full" onClick={addCard}>Add card</Button>
            </Panel>
            <Panel className="space-y-3 p-5">
              <h2 className="text-xl font-semibold">Import cards</h2>
              <p className="text-sm text-slate-500">Paste raw Portuguese lines, CSV, TSV, or JSON.</p>
              <TextArea className="min-h-[160px]" value={importText} onChange={(e) => setImportText(e.target.value)} />
              <Button className="w-full" variant="outline" onClick={importCards}>↑ Import</Button>
            </Panel>
            <Panel className="space-y-3 p-5">
              <h2 className="text-xl font-semibold">Progress controls</h2>
              <Button className="w-full" variant="outline" onClick={resetProgress}>Reset SRS progress</Button>
              <Button className="w-full" variant="outline" onClick={restoreSampleDeck}>Restore sample deck</Button>
              <p className="text-xs text-slate-500">Data is saved locally in this browser. Export regularly for backup.</p>
            </Panel>
          </aside>
        </div>

        <Panel className="p-5">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Card list</h2>
              <p className="text-sm text-slate-500">Showing {visibleCards.length} of {cards.length} cards</p>
            </div>
            <div className="flex w-full gap-2 md:w-[360px]">
              <TextInput placeholder="Search Portuguese, English or example" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {searchQuery && <Button variant="outline" onClick={() => setSearchQuery("")}>Clear</Button>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Portuguese</th>
                  <th className="py-2 pr-3">English</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3">Interval</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleCards.map((card) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    isEditing={editingId === card.id}
                    isConfirmingDelete={deleteConfirmId === card.id}
                    editPt={editPt}
                    editEn={editEn}
                    editExample={editExample}
                    onEditPt={setEditPt}
                    onEditEn={setEditEn}
                    onEditExample={setEditExample}
                    onStartEdit={startEditing}
                    onSave={saveEditing}
                    onCancel={cancelEditing}
                    onRequestDelete={requestDeleteCard}
                    onConfirmDelete={confirmDeleteCard}
                    onCancelDelete={cancelDeleteCard}
                  />
                ))}
              </tbody>
            </table>
            {visibleCards.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-500">No cards match your search.</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
