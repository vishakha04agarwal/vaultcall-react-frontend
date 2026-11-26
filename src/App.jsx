import { useState, useEffect, useMemo, useRef } from "react";
import "./App.css";

const DEFAULT_API_URL =
  import.meta.env.VITE_API_URL || "https://vault-backend-t9nu.onrender.com";

function normalizePhone(raw = "") {
  const digits = String(raw).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(() => {
    const saved = localStorage.getItem("vaultcall_api_url");
    if (!saved || saved.includes("localhost")) {
      return DEFAULT_API_URL;
    }
    return saved;
  });

  const [dbStatus, setDbStatus] = useState("Connecting to Render API...");
  const [profile, setProfile] = useState(() =>
    JSON.parse(
      localStorage.getItem("vaultcall_profile") ||
        '{"name":"Me","phone":"","email":"","lang":"hi-IN"}'
    )
  );
  const [contacts, setContacts] = useState(() =>
    JSON.parse(localStorage.getItem("vaultcall_contacts") || "[]")
  );
  const [transcripts, setTranscripts] = useState(() =>
    JSON.parse(localStorage.getItem("vaultcall_transcripts") || "[]")
  );

  const [tab, setTab] = useState("contacts");
  const [simPhone, setSimPhone] = useState("");
  const [liveLines, setLiveLines] = useState([]);
  const [speaker, setSpeaker] = useState("Me");
  const [lineText, setLineText] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    tag: "Client",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [listeningField, setListeningField] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);

  const recognitionRef = useRef(null);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    localStorage.setItem("vaultcall_api_url", apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    localStorage.setItem("vaultcall_profile", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem("vaultcall_contacts", JSON.stringify(contacts));
  }, [contacts]);

  useEffect(() => {
    localStorage.setItem("vaultcall_transcripts", JSON.stringify(transcripts));
  }, [transcripts]);

  useEffect(() => {
    const clean = apiUrl.trim().replace(/\/$/, "");
    if (!clean) {
      setDbStatus("Local Browser Mode");
      return;
    }

    setDbStatus("Connecting to Render API...");
    fetch(`${clean}/api/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Health check failed"))))
      .then((data) => {
        setDbStatus(data.database || "Neon DB Connected");
        return Promise.all([
          fetch(`${clean}/api/v1/contacts`).then((r) => (r.ok ? r.json() : [])),
          fetch(`${clean}/api/v1/transcripts`).then((r) => (r.ok ? r.json() : [])),
        ]);
      })
      .then(([cRows, tRows]) => {
        if (Array.isArray(cRows)) {
          setContacts(cRows);
          if (cRows[0] && !simPhone) {
            setSimPhone(cRows[0].phone);
          }
        }
        if (Array.isArray(tRows)) {
          setTranscripts(tRows);
        }
      })
      .catch(() => {
        setDbStatus("Offline / Local Fallback");
      });
  }, [apiUrl]);

  const matched = useMemo(() => {
    const normalized = normalizePhone(simPhone);
    if (!normalized) return null;
    return contacts.find((c) => normalizePhone(c.phone) === normalized) || null;
  }, [contacts, simPhone]);

  const showToast = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3200);
  };

  const triggerInstall = async () => {
    if (!installPrompt) {
      showToast("Chrome menu (⋮) -> Install app / Add to Home screen use karein.");
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      showToast("VaultCall PWA install ho gaya!");
    }
  };

  const startVoiceInput = (targetField) => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Is browser mein voice typing supported nahi hai. Chrome try karein.");
      return;
    }

    if (listeningField === targetField && recognitionRef.current) {
      recognitionRef.current.stop();
      setListeningField(null);
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const rec = new SpeechRec();
    rec.lang = profile.lang || "hi-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListeningField(targetField);
      showToast("Bolna shuru karein...");
    };

    rec.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      if (!spoken) return;
      if (targetField === "line") {
        setLineText((prev) => (prev ? `${prev} ${spoken}` : spoken));
      } else if (targetField === "notes") {
        setForm((prev) => ({
          ...prev,
          notes: prev.notes ? `${prev.notes} ${spoken}` : spoken,
        }));
      }
    };

    rec.onerror = () => {
      showToast("Mic permission ya speech capture nahi ho paya.");
      setListeningField(null);
    };

    rec.onend = () => {
      setListeningField(null);
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const addContact = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || normalizePhone(form.phone).length < 6) {
      showToast("Please enter a valid contact name and phone number.");
      return;
    }

    setSaving(true);
    const clean = apiUrl.trim().replace(/\/$/, "");
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      tag: form.tag.trim() || "Client",
      notes: form.notes.trim(),
    };

    if (clean) {
      try {
        const res = await fetch(`${clean}/api/v1/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const saved = await res.json();
          setContacts((prev) => [saved, ...prev]);
          setForm({ name: "", phone: "", tag: "Client", notes: "" });
          setSaving(false);
          showToast("Contact saved to Neon PostgreSQL!");
          return;
        }
      } catch {}
    }

    setContacts((prev) => [{ id: String(Date.now()), ...payload }, ...prev]);
    setForm({ name: "", phone: "", tag: "Client", notes: "" });
    setSaving(false);
    showToast("Saved locally (check backend connection).");
  };

  const speakLine = (spk, text) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const who = spk === "Me" ? profile.name || "Me" : spk;
    const intro =
      profile.lang === "hi-IN" ? `${who} बोल रहे हैं` : `${who} speaking`;
    const u1 = new SpeechSynthesisUtterance(intro);
    u1.lang = profile.lang || "hi-IN";
    const u2 = new SpeechSynthesisUtterance(text);
    u2.lang = profile.lang || "hi-IN";
    window.speechSynthesis.speak(u1);
    window.speechSynthesis.speak(u2);
  };

  const saveTranscript = async () => {
    if (liveLines.length === 0) {
      showToast("Add at least one transcript line first.");
      return;
    }

    setSaving(true);
    const payload = {
      contactId: matched?.id || null,
      contactName: matched ? matched.name : simPhone || "Unknown",
      phone: simPhone,
      duration: "01:00",
      consentEnabled: true,
      lines: liveLines,
    };

    const clean = apiUrl.trim().replace(/\/$/, "");
    if (clean) {
      try {
        const res = await fetch(`${clean}/api/v1/transcripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const saved = await res.json();
          setTranscripts((prev) => [saved, ...prev]);
          setLiveLines([]);
          setTab("transcripts");
          setSaving(false);
          showToast("Transcript saved to Neon DB!");
          return;
        }
      } catch {}
    }

    setTranscripts((prev) => [{ id: String(Date.now()), ...payload }, ...prev]);
    setLiveLines([]);
    setTab("transcripts");
    setSaving(false);
    showToast("Transcript saved locally.");
  };

  const resetApiToRender = () => {
    setApiUrl(DEFAULT_API_URL);
    localStorage.setItem("vaultcall_api_url", DEFAULT_API_URL);
    showToast("Reset API URL to Render backend.");
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>VaultCall PWA</h1>
          <p className="status">
            {dbStatus} • <span className="url-pill">{apiUrl}</span>
          </p>
        </div>
        <div className="header-actions">
          {installPrompt && (
            <button type="button" onClick={triggerInstall} className="btn-install">
              Install App
            </button>
          )}
          <nav className="tabs">
            {["contacts", "popup", "transcripts", "settings"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={tab === t ? "tab active" : "tab"}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {notice && <div className="toast">{notice}</div>}

      {tab === "contacts" && (
        <div className="section">
          <form onSubmit={addContact} className="card form-grid">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Contact Name"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
            <input
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              placeholder="Tag (e.g., Client, VIP)"
              className="full"
            />
            <div className="full row">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Private Notes (type karein ya mic se bolein)"
              />
              <button
                type="button"
                onClick={() => startVoiceInput("notes")}
                className={listeningField === "notes" ? "btn-mic active" : "btn-mic"}
                title="Bolkar note likhein"
              >
                {listeningField === "notes" ? "⏹ Stop" : "🎙️"}
              </button>
            </div>
            <button type="submit" disabled={saving} className="btn-primary full">
              {saving ? "Saving..." : "Save to Neon Database"}
            </button>
          </form>

          <div className="cards-grid">
            {contacts.map((c) => (
              <div key={c.id} className="card">
                <div className="row-between">
                  <h3>{c.name}</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSimPhone(c.phone);
                      setTab("popup");
                    }}
                    className="link-btn"
                  >
                    Test Pop-up
                  </button>
                </div>
                <p className="mono">{c.phone}</p>
                {c.tag && <span className="badge">{c.tag}</span>}
                <p className="note-box">{c.notes || "No notes added."}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "popup" && (
        <div className="card section">
          <label className="label">Caller Number Lookup</label>
          <input
            value={simPhone}
            onChange={(e) => setSimPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
          <div className="note-box">
            <h3>{matched ? matched.name : "Unknown Caller"}</h3>
            <p>
              {matched
                ? matched.notes || "Matched contact in vault."
                : "Number not found in private vault."}
            </p>
          </div>

          <div className="lines">
            {liveLines.map((l, i) => (
              <div key={i} className="line-item">
                <span>
                  <strong>{l.speaker === "Me" ? profile.name || "Me" : l.speaker}:</strong>{" "}
                  {l.text}
                </span>
                <button
                  type="button"
                  onClick={() => speakLine(l.speaker, l.text)}
                  className="icon-btn"
                >
                  🔊
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!lineText.trim()) return;
              setLiveLines([...liveLines, { speaker, text: lineText.trim() }]);
              setLineText("");
            }}
            className="row wrap-mobile"
          >
            <select value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
              <option value="Me">{profile.name || "Me"} (Me)</option>
              <option value={matched ? matched.name : simPhone || "Caller"}>
                {matched ? matched.name : simPhone || "Caller"}
              </option>
            </select>
            <input
              value={lineText}
              onChange={(e) => setLineText(e.target.value)}
              placeholder="Bolein ya type karein..."
            />
            <button
              type="button"
              onClick={() => startVoiceInput("line")}
              className={listeningField === "line" ? "btn-mic active" : "btn-mic"}
              title="Mic se bolein"
            >
              {listeningField === "line" ? "⏹" : "🎙️"}
            </button>
            <button type="submit" className="btn-secondary">
              Add
            </button>
          </form>

          <button
            type="button"
            disabled={saving}
            onClick={saveTranscript}
            className="btn-success full"
          >
            {saving ? "Saving..." : "End Call & Save Transcript to DB"}
          </button>
        </div>
      )}

      {tab === "transcripts" && (
        <div className="section">
          {transcripts.length === 0 && (
            <div className="card">
              <p className="muted">No saved transcripts yet.</p>
            </div>
          )}
          {transcripts.map((tx) => (
            <div key={tx.id} className="card">
              <h3>
                {tx.contact_name || tx.contactName} ({tx.phone || "No number"})
              </h3>
              {(tx.lines || []).map((l, i) => (
                <div key={i} className="line-item">
                  <span>
                    <strong>{l.speaker === "Me" ? profile.name || "Me" : l.speaker}:</strong>{" "}
                    {l.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => speakLine(l.speaker, l.text)}
                    className="icon-btn"
                  >
                    🔊 Listen
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "settings" && (
        <div className="card section">
          <h3>Render Backend API URL & Profile</h3>
          <label className="label">Backend URL</label>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://vault-backend-t9nu.onrender.com"
          />
          <button type="button" onClick={resetApiToRender} className="btn-secondary">
            Reset to https://vault-backend-t9nu.onrender.com
          </button>

          <label className="label">Your Name</label>
          <input
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="Your Name"
          />

          <label className="label">Voice Language</label>
          <select
            value={profile.lang}
            onChange={(e) => setProfile({ ...profile, lang: e.target.value })}
          >
            <option value="hi-IN">Hindi (hi-IN)</option>
            <option value="en-IN">English (en-IN)</option>
          </select>
        </div>
      )}
    </div>
  );
}
