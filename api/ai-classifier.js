const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic();

const URGENCY_LEVELS = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};

const SENDER_CATEGORIES = {
  INVESTORS: "Investors",
  COMPLIANCE: "Compliance/Legal",
  INTERNAL: "Internal",
  BANKS: "Banks/Financial",
  PORTFOLIO: "Portfolio Companies",
  VENDORS: "Vendors/FYI"
};

async function classifyUrgency(email) {
  const prompt = `You are an email triage expert for Azim at Blume Ventures.
Analyze:
FROM: ${email.from}
SUBJECT: ${email.subject}
PREVIEW: ${email.snippet}
BODY: ${email.body || email.snippet}

RESPOND WITH JSON (NO MARKDOWN):
{
  "urgency": "CRITICAL|HIGH|MEDIUM|LOW",
  "category": "INVESTORS|COMPLIANCE|INTERNAL|BANKS|PORTFOLIO|VENDORS",
  "isUrgent": boolean,
  "actionRequired": boolean,
  "actionDescription": "brief action",
  "deadline": "YYYY-MM-DD or null",
  "reasons": ["reason1"],
  "recommendedNextStep": "action",
  "responseTimeframe": "same day|24 hours|48 hours|72 hours|no response needed"
}`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const classified = JSON.parse(jsonMatch[0]);
    return {
      ...classified,
      urgencyLabel: URGENCY_LEVELS[classified.urgency] || classified.urgency,
      categoryLabel: SENDER_CATEGORIES[classified.category] || classified.category
    };
  } catch (error) {
    console.error("[AI_CLASSIFIER] Classification error:", error.message);
    return {
      urgency: "MEDIUM",
      category: "VENDORS",
      isUrgent: false,
      actionRequired: false,
      actionDescription: "Review manually",
      deadline: null,
      reasons: ["Classification failed"],
      recommendedNextStep: "Review manually",
      responseTimeframe: "72 hours",
      urgencyLabel: "MEDIUM",
      categoryLabel: "Vendors/FYI",
      error: error.message
    };
  }
}

async function generateCategorySummary(emails, category) {
  if (!emails.length) {
    return {
      categorySummary: "No emails",
      keyActionItems: [],
      pendingResponses: 0,
      criticalDeadlines: [],
      briefHighlights: []
    };
  }

  const emailList = emails
    .map(e => `- FROM: ${e.from}\n  SUBJECT: ${e.subject}\n  PREVIEW: ${e.snippet}`)
    .join("\n");

  const prompt = `Executive assistant for Blume Ventures.
CATEGORY: ${category}
EMAILS:
${emailList}

Provide a JSON summary (NO MARKDOWN):
{
  "categorySummary": "summary",
  "keyActionItems": [],
  "pendingResponses": 0,
  "criticalDeadlines": [],
  "briefHighlights": []
}`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("[AI_CLASSIFIER] Summary generation error:", error.message);
    return {
      categorySummary: "Review manually",
      keyActionItems: [],
      pendingResponses: emails.length,
      criticalDeadlines: [],
      briefHighlights: [],
      error: error.message
    };
  }
}

module.exports = {
  classifyUrgency,
  generateCategorySummary,
  URGENCY_LEVELS,
  SENDER_CATEGORIES
};
