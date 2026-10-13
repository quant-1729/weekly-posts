// Setup chat questions (R2). Kept apart from the extraction prompt so the
// browser bundle gets the questions without the system prompt.
// Owned by the orchestrator.

// The questions the setup chat asks, in order. The UI shows them one at a time
// (text or voice answer each), or as a checklist for a single voice note.
// Language and script, tone, logo, colours are picked by tapping, not asked here.
export const SETUP_QUESTIONS = [
  { key: 'business', en: 'What is your business called, and what do you sell or do?', hi: 'आपके बिज़नेस का नाम क्या है, और आप क्या बेचते या करते हैं?' },
  { key: 'city', en: 'Which city and area are you in?', hi: 'आपकी दुकान किस शहर और इलाके में है?' },
  { key: 'products', en: 'Tell us your main products or services, with prices if you want them in posts.', hi: 'आपके मुख्य सामान या सर्विस बताइए, और दाम भी, अगर पोस्ट में दिखाने हैं।' },
  { key: 'audience', en: 'Who are your usual customers?', hi: 'आपके ज़्यादातर ग्राहक कौन हैं?' },
  { key: 'other', en: 'Anything else customers should know? Timings, address, home delivery, regular offers.', hi: 'ग्राहकों को और क्या पता होना चाहिए? समय, पता, होम डिलीवरी, रेगुलर ऑफ़र।' },
] as const;

export type SetupQuestionKey = (typeof SETUP_QUESTIONS)[number]['key'];
