const { callLLMJson } = require('../tools/llm');

async function classifyRequest(goal, context = [], hasWorkspace = false) {
  return callLLMJson(
      `Current input: ${goal}
Conversation: ${JSON.stringify(context)}
${hasWorkspace ? "An editable coding workspace is open. Treat requests to change its appearance, behavior, or files as coding tasks. Questions about the code may be answered as chat." : ""}
Classify as clarify (essential information or a meaningful user choice is missing), chat (greetings, conversation, questions/explanations answerable without tools) or task (research, files, code, external apps, multi-step work).
For clarify, ask ONE brief question with concrete options when useful. Do not execute any work yet. Ask only when the answer materially changes the work: ambiguous destination, missing recipient/content, or user preferences needed for a useful personalized result. For a workout request with no prior context, ask home or gym and available equipment before creating a personalized routine. Do not ask again if the conversation already answers it. Interpret short answers such as "gym" as answers to your previous question and continue the original task using the whole conversation. For chat, answer naturally and concisely, using the conversation context. Never claim you accessed an app or searched the web.
Return JSON: {"type":"chat|task|clarify","reply":"answer for chat or question for clarify, empty for task"}`,
      { maxTokens: 2048, temperature: 0.3 }
    );
}
module.exports = { classifyRequest };
