const { classifyUrgency } = require("./ai-classifier");

async function gmailFetch(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (res.status === 401) throw new Error("Gmail session expired - please sign in again");
  return res.json();
}

async function fetchThreadDetail(accessToken, threadId) {
  return gmailFetch(accessToken, "https://www.googleapis.com/gmail/v1/users/me/threads/" + threadId + "?format=full&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date");
}

function getHeader(headers, name) {
  return (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractEmail(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader;
}

function extractName(fromHeader) {
  return fromHeader.replace(/<[^>]*>/g, "").trim() || fromHeader.split("@")[0];
}

function isProbablyUrgent(subject, snippet, from) {
  const urgentKeywords = ["approval","urgent","asap","deadline","overdue","compliance","pending","required","action","investor","capital call","escalation","critical","payment","penalty","show cause","audit","legal","regulatory","sebi","fatca","kyc","drawdown","nav"];
  const text = (subject + " " + snippet + " " + from).toLowerCase();
  return urgentKeywords.some((kw) => text.includes(kw));
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { accessToken, threadIds } = req.body;
    if (!accessToken) return res.status(400).json({ error: "Missing accessToken" });
    console.log("[CLASSIFY_URGENT] Starting classification...");
    let threadsToClassify = [];
    if (threadIds && threadIds.length) {
      threadsToClassify = threadIds.slice(0, 20);
    } else {
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      const data = await gmailFetch(accessToken, "https://www.googleapis.com/gmail/v1/users/me/threads?maxResults=30&q=in:inbox+is:unread+after:" + since + "&fields=threads(id,snippet,messages(id,payload(headers)))");
      const threads = data.threads || [];
      console.log("[CLASSIFY_URGENT] Found " + threads.length + " recent unread threads");
      for (const thread of threads) {
        const msg = thread.messages?.[0];
        const subject = getHeader(msg?.payload?.headers, "Subject");
        const from = getHeader(msg?.payload?.headers, "From");
        const snippet = thread.snippet || "";
        if (isProbablyUrgent(subject, snippet, from)) threadsToClassify.push(thread.id);
      }
    }
    console.log("[CLASSIFY_URGENT] Classifying " + threadsToClassify.length + " threads");
    const details = [];
    for (const threadId of threadsToClassify) {
      try { details.push(await fetchThreadDetail(accessToken, threadId)); } catch (err) { console.error("[CLASSIFY_URGENT] Error fetching thread:", err.message); }
    }
    const classified = [];
    for (const thread of details) {
      try {
        const msgs = thread.messages || [];
        if (!msgs.length) continue;
        const first = msgs[0];
        const last = msgs[msgs.length - 1];
        const email = {
          threadId: thread.id,
          from: extractName(getHeader(first?.payload?.headers, "From")),
          fromEmail: extractEmail(getHeader(first?.payload?.headers, "From")),
          subject: getHeader(first?.payload?.headers, "Subject") || "(no subject)",
          snippet: thread.snippet || "",
          body: last?.payload?.parts?.[0]?.body?.data || last?.payload?.body?.data || thread.snippet || "",
          date: getHeader(first?.payload?.headers, "Date"),
          messageCount: msgs.length,
        };
        if (email.body && typeof email.body === "string" && email.body !== thread.snippet) {
          try { email.body = Buffer.from(email.body, "base64").toString("utf-8"); } catch (e) {}
        }
        const result = await classifyUrgency(email);
        if (result.isUrgent) classified.push({ thread, email, classified: result });
        console.log("[CLASSIFY_URGENT] " + email.subject + ": " + result.urgency + " (isUrgent: " + result.isUrgent + ")");
      } catch (err) { console.error("[CLASSIFY_URGENT] Classification error:", err.message); }
    }
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    classified.sort((a, b) => urgencyOrder[a.classified.urgency] - urgencyOrder[b.classified.urgency]);
    console.log("[CLASSIFY_URGENT] Found " + classified.length + " urgent emails");
    res.status(200).json({
      urgent: classified.slice(0, 20).map((item) => ({
        threadId: item.thread.id, from: item.email.from, fromEmail: item.email.fromEmail,
        subject: item.email.subject, snippet: item.email.snippet, date: item.email.date,
        messageCount: item.email.messageCount, urgency: item.classified.urgency,
        urgencyLabel: item.classified.urgencyLabel, category: item.classified.category,
        categoryLabel: item.classified.categoryLabel, actionRequired: item.classified.actionRequired,
        actionDescription: item.classified.actionDescription, deadline: item.classified.deadline,
        recommendedNextStep: item.classified.recommendedNextStep, responseTimeframe: item.classified.responseTimeframe,
        reasons: item.classified.reasons,
      })),
      timestamp: new Date().toISOString(),
      totalClassified: classified.length,
    });
  } catch (error) {
    console.error("[CLASSIFY_URGENT] Error:", error);
    res.status(500).json({ error: error.message || "Classification failed", timestamp: new Date().toISOString() });
  }
}

module.exports = handler;
