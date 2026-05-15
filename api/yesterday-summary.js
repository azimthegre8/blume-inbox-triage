const { generateCategorySummary } = require("./ai-classifier");

async function gmailFetch(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (res.status === 401) throw new Error("Gmail session expired - please sign in again");
  return res.json();
}

function getHeader(headers, name) {
  return (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractName(fromHeader) {
  return fromHeader.replace(/<[^>]*>/g, "").trim() || fromHeader.split("@")[0];
}

function categorizeEmail(email) {
  const text = (email.from + " " + email.subject).toLowerCase();
  const patterns = {
    Investors: /investor|lp |limited partner|fund manager|sequoia|accel|tiger|a16z|lightspeed|vertex|avantgarde|grant/i,
    Compliance: /sebi|regulatory|compliance|audit|legal|aml|kyc|fatca|ckyc|penalty|show cause|adjudication|nsdl|tds/i,
    Banks: /icici|hdfc|axis|sbi|yes bank|idfc|kotak|bank|neft|rtgs|wire|settlement/i,
    "Portfolio Companies": /portfolio|fund|investee|startup|company|founder|cfo|board|mis|investment|term sheet/i,
    Internal: /blume|team|internal|ops|hr|admin|granola|meeting|approval needed|review/i,
  };
  for (const [category, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) return category;
  }
  return "Vendors/FYI";
}

async function fetchYesterdayEmails(accessToken) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfDay = Math.floor(new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0).getTime() / 1000);
  const endOfDay = Math.floor(new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59).getTime() / 1000);

  console.log("[YESTERDAY_SUMMARY] Fetching emails from " + new Date(startOfDay * 1000).toDateString());

  const data = await gmailFetch(accessToken, "https://www.googleapis.com/gmail/v1/users/me/threads?maxResults=50&q=is:unread+after:" + startOfDay + "+before:" + endOfDay + "&fields=threads(id,snippet,messages(id,payload(headers)))");
  const threads = data.threads || [];
  console.log("[YESTERDAY_SUMMARY] Found " + threads.length + " unread threads");

  const emails = [];
  for (const thread of threads) {
    const msg = thread.messages?.[0];
    if (!msg) continue;
    const from = getHeader(msg?.payload?.headers, "From");
    const subject = getHeader(msg?.payload?.headers, "Subject");
    emails.push({
      threadId: thread.id,
      from: extractName(from),
      subject: subject || "(no subject)",
      snippet: thread.snippet || "",
      category: categorizeEmail({ from, subject })
    });
  }
  return emails;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: "Missing accessToken" });

    console.log("[YESTERDAY_SUMMARY] Starting summary generation");
    const emails = await fetchYesterdayEmails(accessToken);

    if (!emails.length) {
      return res.status(200).json({
        summary: {
          generated: new Date().toISOString(),
          totalUnread: 0,
          categories: {},
          message: "No unread emails from yesterday"
        }
      });
    }

    const grouped = {};
    for (const email of emails) {
      if (!grouped[email.category]) grouped[email.category] = [];
      grouped[email.category].push(email);
    }

    console.log("[YESTERDAY_SUMMARY] Categories:", Object.keys(grouped));

    const summaries = {};
    for (const [category, categoryEmails] of Object.entries(grouped)) {
      try {
        const s = await generateCategorySummary(categoryEmails, category);
        summaries[category] = {
          count: categoryEmails.length,
          summary: s.categorySummary || "See emails below",
          actionItems: s.keyActionItems || [],
          pendingResponses: s.pendingResponses || categoryEmails.length,
          criticalDeadlines: s.criticalDeadlines || [],
          highlights: s.briefHighlights || [],
          emails: categoryEmails.slice(0, 5).map((e) => ({
            threadId: e.threadId,
            from: e.from,
            subject: e.subject,
            snippet: e.snippet.substring(0, 100)
          })),
        };
      } catch (err) {
        summaries[category] = {
          count: categoryEmails.length,
          summary: "Manual review required",
          actionItems: [],
          pendingResponses: categoryEmails.length,
          criticalDeadlines: [],
          highlights: [],
          emails: categoryEmails.slice(0, 5).map((e) => ({
            threadId: e.threadId,
            from: e.from,
            subject: e.subject,
            snippet: e.snippet.substring(0, 100)
          }))
        };
      }
    }

    const yd = new Date();
    yd.setDate(yd.getDate() - 1);

    res.status(200).json({
      summary: {
        generated: new Date().toISOString(),
        totalUnread: emails.length,
        yesterday: yd.toISOString().split("T")[0],
        categories: summaries
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Summary generation failed", timestamp: new Date().toISOString() });
  }
};
