var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _status, _llm, _abortController, _observations, _states, _PageAgentCore_instances, emitStatusChange_fn, emitHistoryChange_fn, emitActivity_fn, setStatus_fn, packMacroTool_fn, getSystemPrompt_fn, getInstructions_fn, handleObservations_fn, assembleUserPrompt_fn, onDone_fn;
import { InvokeError, InvokeErrorType, LLM } from "@page-agent/llms";
import chalk from "chalk";
import * as z from "zod/v4";
const SYSTEM_PROMPT = 'You are an AI agent designed to operate in an iterative loop to automate browser tasks. Your ultimate goal is accomplishing the task provided in <user_request>.\n\n<intro>\nYou excel at following tasks:\n1. Navigating complex websites and extracting precise information\n2. Automating form submissions and interactive web actions\n3. Gathering and saving information \n4. Operate effectively in an agent loop\n5. Efficiently performing diverse web tasks\n</intro>\n\n<language_settings>\n- Default working language: **English**\n- Use the language that user is using. Return in user\'s language.\n</language_settings>\n\n<input>\nAt every step, your input will consist of: \n1. <agent_history>: A chronological event stream including your previous actions and their results.\n2. <agent_state>: Current <user_request> and <step_info>.\n3. <browser_state>: Current URL, interactive elements indexed for actions, and visible page content.\n</input>\n\n<agent_history>\nAgent history will be given as a list of step information as follows:\n\n<step_{step_number}>:\nEvaluation of Previous Step: Assessment of last action\nMemory: Your memory of this step\nNext Goal: Your goal for this step\nAction Results: Your actions and their results\n</step_{step_number}>\n\nand system messages wrapped in <sys> tag.\n</agent_history>\n\n<user_request>\nUSER REQUEST: This is your ultimate objective and always remains visible.\n- This has the highest priority. Make the user happy.\n- If the user request is very specific - then carefully follow each step and dont skip or hallucinate steps.\n- If the task is open ended you can plan yourself how to get it done.\n</user_request>\n\n<browser_state>\n1. Browser State will be given as:\n\nCurrent URL: URL of the page you are currently viewing.\nInteractive Elements: All interactive elements will be provided in format as [index]<type>text</type> where\n- index: Numeric identifier for interaction\n- type: HTML element type (button, input, etc.)\n- text: Element description\n\nExamples:\n[33]<div>User form</div>\n\\t*[35]<button aria-label=\'Submit form\'>Submit</button>\n\nNote that:\n- Only elements with numeric indexes in [] are interactive\n- (stacked) indentation (with \\t) is important and means that the element is a (html) child of the element above (with a lower index)\n- Elements tagged with `*[` are the new clickable elements that appeared on the website since the last step - if url has not changed.\n- Pure text elements without [] are not interactive.\n</browser_state>\n\n<browser_rules>\nStrictly follow these rules while using the browser and navigating the web:\n- Only interact with elements that have a numeric [index] assigned.\n- Only use indexes that are explicitly provided.\n- If the page changes after, for example, an input text action, analyze if you need to interact with new elements, e.g. selecting the right option from the list.\n- By default, only elements in the visible viewport are listed. Use scrolling actions if you suspect relevant content is offscreen which you need to interact with. Scroll ONLY if there are more pixels below or above the page.\n- You can scroll by a specific number of pages using the num_pages parameter (e.g., 0.5 for half page, 2.0 for two pages).\n- All the elements that are scrollable are marked with `data-scrollable` attribute. Including the scrollable distance in every directions. You can scroll *the element* in case some area are overflowed.\n- If a captcha appears, tell user you can not solve captcha. Finish the task and ask user to solve it.\n- If expected elements are missing, try scrolling, or navigating back.\n- If the page is not fully loaded, use the `wait` action.\n- Do not repeat one action for more than 3 times unless some conditions changed.\n- If you fill an input field and your action sequence is interrupted, most often something changed e.g. suggestions popped up under the field.\n- If the <user_request> includes specific page information such as product type, rating, price, location, etc., try to apply filters to be more efficient.\n- The <user_request> is the ultimate goal. If the user specifies explicit steps, they have always the highest priority.\n- If you input_text into a field, you might need to press enter, click the search button, or select from dropdown for completion.\n- Don\'t login into a page if you don\'t have to. Don\'t login if you don\'t have the credentials. \n- There are 2 types of tasks always first think which type of request you are dealing with:\n1. Very specific step by step instructions:\n- Follow them as very precise and don\'t skip steps. Try to complete everything as requested.\n2. Open ended tasks. Plan yourself, be creative in achieving them.\n- If you get stuck e.g. with logins or captcha in open-ended tasks you can re-evaluate the task and try alternative ways, e.g. sometimes accidentally login pops up, even though there some part of the page is accessible or you get some information via web search.\n</browser_rules>\n\n<capability>\n- You can only handle single page app. Do not jump out of current page.\n- Do not click on link if it will open in a new page (e.g., <a target="_blank">)\n- It is ok to fail the task.\n	- User can be wrong. If the request of user is not achievable, inappropriate or you do not have enough information or tools to achieve it. Tell user to make a better request.\n	- Webpage can be broken. All webpages or apps have bugs. Some bug will make it hard for your job. It\'s encouraged to tell user the problem of current page. Your feedbacks (including failing) are valuable for user.\n	- Trying too hard can be harmful. Repeating some action back and forth or pushing for a complex procedure with little knowledge can cause unwanted results and harmful side-effects. User would rather you complete the task with a fail.\n- If you do not have knowledge for the current webpage or task. You must require user to give specific instructions and detailed steps.\n</capability>\n\n<task_completion_rules>\nYou must call the `done` action in one of three cases:\n- When you have fully completed the USER REQUEST.\n- When you reach the final allowed step (`max_steps`), even if the task is incomplete.\n- When you feel stuck or unable to solve user request. Or user request is not clear or contains inappropriate content.\n- If it is ABSOLUTELY IMPOSSIBLE to continue.\n\nThe `done` action is your opportunity to terminate and share your findings with the user.\n- Set `success` to `true` only if the full USER REQUEST has been completed with no missing components.\n- If any part of the request is missing, incomplete, or uncertain, set `success` to `false`.\n- You can use the `text` field of the `done` action to communicate your findings and to provide a coherent reply to the user and fulfill the USER REQUEST.\n- You are ONLY ALLOWED to call `done` as a single action. Don\'t call it together with other actions.\n- If the user asks for specified format, such as "return JSON with following structure", "return a list of format...", MAKE sure to use the right format in your answer.\n- If the user asks for a structured output, your `done` action\'s schema may be modified. Take this schema into account when solving the task!\n</task_completion_rules>\n\n<reasoning_rules>\nExhibit the following reasoning patterns to successfully achieve the <user_request>:\n\n- Reason about <agent_history> to track progress and context toward <user_request>.\n- Analyze the most recent "Next Goal" and "Action Result" in <agent_history> and clearly state what you previously tried to achieve.\n- Analyze all relevant items in <agent_history> and <browser_state> to understand your state.\n- Explicitly judge success/failure/uncertainty of the last action. Never assume an action succeeded just because it appears to be executed in your last step in <agent_history>. If the expected change is missing, mark the last action as failed (or uncertain) and plan a recovery.\n- Analyze whether you are stuck, e.g. when you repeat the same actions multiple times without any progress. Then consider alternative approaches e.g. scrolling for more context or ask user for help.\n- Ask user for help if you have any difficulty. Keep user in the loop.\n- If you see information relevant to <user_request>, plan saving the information to memory.\n- Always reason about the <user_request>. Make sure to carefully analyze the specific steps and information required. E.g. specific filters, specific form fields, specific information to search. Make sure to always compare the current trajectory with the user request and think carefully if thats how the user requested it.\n</reasoning_rules>\n\n<examples>\nHere are examples of good output patterns. Use them as reference but never copy them directly.\n\n<evaluation_examples>\n"evaluation_previous_goal": "Successfully navigated to the product page and found the target information. Verdict: Success"\n"evaluation_previous_goal": "Clicked the login button and user authentication form appeared. Verdict: Success"\n</evaluation_examples>\n\n<memory_examples>\n"memory": "Found many pending reports that need to be analyzed in the main page. Successfully processed the first 2 reports on quarterly sales data and moving on to inventory analysis and customer feedback reports."\n</memory_examples>\n\n<next_goal_examples>\n"next_goal": "Click on the \'Add to Cart\' button to proceed with the purchase flow."\n</next_goal_examples>\n</examples>\n\n<output>\n{\n  "evaluation_previous_goal": "Concise one-sentence analysis of your last action. Clearly state success, failure, or uncertain.",\n  "memory": "1-3 concise sentences of specific memory of this step and overall progress. You should put here everything that will help you track progress in future steps. Like counting pages visited, items found, etc.",\n  "next_goal": "State the next immediate goal and action to achieve it, in one clear sentence.",\n  "action":{\n    "Action name": {// Action parameters}\n  }\n}\n</output>\n';
const log = console.log.bind(console, chalk.yellow("[autoFixer]"));
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject, "isPlainObject");
function isMacroPayload(value) {
  return isPlainObject(value) && (isPlainObject(value.action) || typeof value.evaluation_previous_goal === "string" || typeof value.memory === "string" || typeof value.next_goal === "string");
}
__name(isMacroPayload, "isMacroPayload");
function extractJSONObjectSegments(text) {
  if (typeof text !== "string") return [];
  const source = text.trim();
  if (!source) return [];
  const segments = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        segments.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return segments;
}
__name(extractJSONObjectSegments, "extractJSONObjectSegments");
function normalizeJsonLikeValue(input) {
  if (typeof input !== "string") return input;
  let source = input.trim();
  if (!source) return input;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = JSON.parse(source);
      if (isPlainObject(parsed) || Array.isArray(parsed)) {
        return parsed;
      }
      if (typeof parsed === "string" && parsed.trim() && parsed.trim() !== source) {
        source = parsed.trim();
        continue;
      }
      return parsed;
    } catch {
      break;
    }
  }
  const segments = extractJSONObjectSegments(source);
  if (!segments.length) return input;
  let fallback = null;
  for (const segment of segments) {
    try {
      const parsed = JSON.parse(segment);
      if (isMacroPayload(parsed)) {
        return parsed;
      }
      if (isPlainObject(parsed) && (!fallback || Object.keys(parsed).length > 0)) {
        fallback = parsed;
      }
    } catch {
    }
  }
  return fallback ?? input;
}
__name(normalizeJsonLikeValue, "normalizeJsonLikeValue");
function normalizeResponse(response, tools2) {
  let resolvedArguments = null;
  const choice = response.choices?.[0];
  if (!choice) throw new Error("No choices in response");
  const message = choice.message;
  if (!message) throw new Error("No message in choice");
  const toolCall = message.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    resolvedArguments = safeJsonParse(toolCall.function.arguments);
    if (toolCall.function.name && toolCall.function.name !== "AgentOutput") {
      log(`#1: fixing tool_call`);
      resolvedArguments = { action: safeJsonParse(resolvedArguments) };
    }
  } else {
    if (message.content) {
      const content = message.content.trim();
      const jsonInContent = retrieveJsonFromString(content);
      if (jsonInContent) {
        resolvedArguments = safeJsonParse(jsonInContent);
        if (resolvedArguments?.name === "AgentOutput") {
          log(`#2: fixing tool_call`);
          resolvedArguments = safeJsonParse(resolvedArguments.arguments);
        }
        if (resolvedArguments?.type === "function") {
          log(`#3: fixing tool_call`);
          resolvedArguments = safeJsonParse(resolvedArguments.function.arguments);
        }
        if (!resolvedArguments?.action && !resolvedArguments?.evaluation_previous_goal && !resolvedArguments?.memory && !resolvedArguments?.next_goal && !resolvedArguments?.thinking) {
          log(`#4: fixing tool_call`);
          resolvedArguments = { action: safeJsonParse(resolvedArguments) };
        }
      } else {
        throw new Error("No tool_call and the message content does not contain valid JSON");
      }
    } else {
      throw new Error("No tool_call nor message content is present");
    }
  }
  resolvedArguments = safeJsonParse(resolvedArguments);
  if (!isPlainObject(resolvedArguments)) {
    const normalizedArguments = normalizeJsonLikeValue(resolvedArguments);
    resolvedArguments = isPlainObject(normalizedArguments) ? normalizedArguments : {};
  }
  if (resolvedArguments.action) {
    resolvedArguments.action = safeJsonParse(resolvedArguments.action);
  }
  if (resolvedArguments.action && !isPlainObject(resolvedArguments.action)) {
    const normalizedAction = normalizeJsonLikeValue(resolvedArguments.action);
    resolvedArguments.action = isPlainObject(normalizedAction) ? normalizedAction : null;
  }
  if (resolvedArguments.action && tools2) {
    resolvedArguments.action = validateAction(resolvedArguments.action, tools2);
  }
  if (!resolvedArguments.action) {
    log(`#5: fixing tool_call`);
    resolvedArguments.action = { name: "wait", input: { seconds: 1 } };
  }
  return {
    ...response,
    choices: [
      {
        ...choice,
        message: {
          ...message,
          tool_calls: [
            {
              ...toolCall || {},
              function: {
                ...toolCall?.function || {},
                name: "AgentOutput",
                arguments: JSON.stringify(resolvedArguments)
              }
            }
          ]
        }
      }
    ]
  };
}
__name(normalizeResponse, "normalizeResponse");
function validateAction(action, tools2) {
  if (typeof action !== "object" || action === null) return action;
  const toolName = Object.keys(action)[0];
  if (!toolName) return action;
  const tool2 = tools2.get(toolName);
  if (!tool2) {
    const available = Array.from(tools2.keys()).join(", ");
    throw new InvokeError(
      InvokeErrorType.INVALID_TOOL_ARGS,
      `Unknown action "${toolName}". Available: ${available}`
    );
  }
  let value = action[toolName];
  const schema = tool2.inputSchema;
  if (schema instanceof z.ZodObject && value !== null && typeof value !== "object") {
    const requiredKey = Object.keys(schema.shape).find(
      (k) => !schema.shape[k].safeParse(void 0).success
    );
    if (requiredKey) {
      log(`coercing primitive action input for "${toolName}"`);
      value = { [requiredKey]: value };
    }
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvokeError(
      InvokeErrorType.INVALID_TOOL_ARGS,
      `Invalid input for action "${toolName}": ${z.prettifyError(result.error)}`
    );
  }
  return { [toolName]: result.data };
}
__name(validateAction, "validateAction");
function safeJsonParse(input) {
  if (typeof input === "string") {
    return normalizeJsonLikeValue(input);
  }
  return input;
}
__name(safeJsonParse, "safeJsonParse");
function retrieveJsonFromString(str) {
  const normalized = normalizeJsonLikeValue(str);
  if (isPlainObject(normalized) || Array.isArray(normalized)) {
    return normalized;
  }
  try {
    const json = /({[\s\S]*})/.exec(str) ?? [];
    if (json.length === 0) {
      return null;
    }
    return normalizeJsonLikeValue(json[0]);
  } catch {
    return null;
  }
}
__name(retrieveJsonFromString, "retrieveJsonFromString");
async function waitFor(seconds) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
}
__name(waitFor, "waitFor");
function truncate(text, maxLength) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...";
  }
  return text;
}
__name(truncate, "truncate");
function randomID(existingIDs) {
  let id = Math.random().toString(36).substring(2, 11);
  if (!existingIDs) {
    return id;
  }
  const MAX_TRY = 1e3;
  let tryCount = 0;
  while (existingIDs.includes(id)) {
    id = Math.random().toString(36).substring(2, 11);
    tryCount++;
    if (tryCount > MAX_TRY) {
      throw new Error("randomID: too many tries");
    }
  }
  return id;
}
__name(randomID, "randomID");
const _global = globalThis;
if (!_global.__PAGE_AGENT_IDS__) {
  _global.__PAGE_AGENT_IDS__ = [];
}
const ids = _global.__PAGE_AGENT_IDS__;
function uid() {
  const id = randomID(ids);
  ids.push(id);
  return id;
}
__name(uid, "uid");
const llmsTxtCache = /* @__PURE__ */ new Map();
async function fetchLlmsTxt(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (origin === "null") return null;
  if (llmsTxtCache.has(origin)) return llmsTxtCache.get(origin);
  const endpoint = `${origin}/llms.txt`;
  let result = null;
  try {
    console.log(chalk.gray(`[llms.txt] Fetching ${endpoint}`));
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(3e3) });
    if (res.ok) {
      result = await res.text();
      console.log(chalk.green(`[llms.txt] Found (${result.length} chars)`));
      if (result.length > 1e3) {
        console.log(chalk.yellow(`[llms.txt] Truncating to 1000 chars`));
        result = truncate(result, 1e3);
      }
    } else {
      console.debug(chalk.gray(`[llms.txt] ${res.status} for ${endpoint}`));
    }
  } catch (e) {
    console.debug(chalk.gray(`[llms.txt] not found for ${endpoint}`), e);
  }
  llmsTxtCache.set(origin, result);
  return result;
}
__name(fetchLlmsTxt, "fetchLlmsTxt");
function assert(condition, message, silent) {
  if (!condition) {
    const errorMessage = message ?? "Assertion failed";
    console.error(chalk.red(`❌ assert: ${errorMessage}`));
    throw new Error(errorMessage);
  }
}
__name(assert, "assert");
function tool(options) {
  return options;
}
__name(tool, "tool");
const tools = /* @__PURE__ */ new Map();
tools.set(
  "done",
  tool({
    description: "Complete task. Text is your final response to the user — keep it concise unless the user explicitly asks for detail.",
    inputSchema: z.object({
      text: z.string(),
      success: z.boolean().default(true)
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      return Promise.resolve("Task completed");
    }, "execute")
  })
);
tools.set(
  "wait",
  tool({
    description: "Wait for x seconds. Can be used to wait until the page or data is fully loaded.",
    inputSchema: z.object({
      seconds: z.number().min(1).max(10).default(1)
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const lastTimeUpdate = await this.pageController.getLastUpdateTime();
      const actualWaitTime = Math.max(0, input.seconds - (Date.now() - lastTimeUpdate) / 1e3);
      console.log(`actualWaitTime: ${actualWaitTime} seconds`);
      await waitFor(actualWaitTime);
      return `✅ Waited for ${input.seconds} seconds.`;
    }, "execute")
  })
);
tools.set(
  "ask_user",
  tool({
    description: "Ask the user a question and wait for their answer. Use this if you need more information or clarification.",
    inputSchema: z.object({
      question: z.string()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      if (!this.onAskUser) {
        throw new Error("ask_user tool requires onAskUser callback to be set");
      }
      const answer = await this.onAskUser(input.question);
      return `User answered: ${answer}`;
    }, "execute")
  })
);
tools.set(
  "click_element_by_index",
  tool({
    description: "Click element by index",
    inputSchema: z.object({
      index: z.int().min(0)
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.clickElement(input.index);
      return result.message;
    }, "execute")
  })
);
tools.set(
  "input_text",
  tool({
    description: "Click and type text into an interactive input element",
    inputSchema: z.object({
      index: z.int().min(0),
      text: z.string()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.inputText(input.index, input.text);
      return result.message;
    }, "execute")
  })
);
tools.set(
  "select_dropdown_option",
  tool({
    description: "Select dropdown option for interactive element index by the text of the option you want to select",
    inputSchema: z.object({
      index: z.int().min(0),
      text: z.string()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.selectOption(input.index, input.text);
      return result.message;
    }, "execute")
  })
);
tools.set(
  "scroll",
  tool({
    description: "Scroll the page vertically. Use index for scroll elements (dropdowns/custom UI).",
    inputSchema: z.object({
      down: z.boolean().default(true),
      num_pages: z.number().min(0).max(10).optional().default(0.1),
      pixels: z.number().int().min(0).optional(),
      index: z.number().int().min(0).optional()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.scroll({
        ...input,
        numPages: input.num_pages
      });
      return result.message;
    }, "execute")
  })
);
tools.set(
  "scroll_horizontally",
  tool({
    description: "Scroll the page horizontally, or within a specific element by index. Useful for wide tables.",
    inputSchema: z.object({
      right: z.boolean().default(true),
      pixels: z.number().int().min(0),
      index: z.number().int().min(0).optional()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.scrollHorizontally(input);
      return result.message;
    }, "execute")
  })
);
tools.set(
  "execute_javascript",
  tool({
    description: "Execute JavaScript code on the current page. Supports async/await syntax. Use with caution!",
    inputSchema: z.object({
      script: z.string()
    }),
    execute: /* @__PURE__ */ __name(async function(input) {
      const result = await this.pageController.executeJavascript(input.script);
      return result.message;
    }, "execute")
  })
);
const _PageAgentCore = class _PageAgentCore extends EventTarget {
  constructor(config) {
    super();
    __privateAdd(this, _PageAgentCore_instances);
    __publicField(this, "id", uid());
    __publicField(this, "config");
    __publicField(this, "tools");
    /** PageController for DOM operations */
    __publicField(this, "pageController");
    __publicField(this, "task", "");
    __publicField(this, "taskId", "");
    /** History events */
    __publicField(this, "history", []);
    /** Whether this agent has been disposed */
    __publicField(this, "disposed", false);
    /**
     * Callback for when agent needs user input (ask_user tool)
     * If not set, ask_user tool will be disabled
     * @example onAskUser: (q) => window.prompt(q) || ''
     */
    __publicField(this, "onAskUser");
    __privateAdd(this, _status, "idle");
    __privateAdd(this, _llm);
    __privateAdd(this, _abortController, new AbortController());
    __privateAdd(this, _observations, []);
    /** internal states during a single task execution */
    __privateAdd(this, _states, {
      /** Accumulated wait time in seconds */
      totalWaitTime: 0,
      /** For detecting navigation */
      lastURL: "",
      /** Browser state */
      browserState: null
    });
    this.config = { ...config, maxSteps: config.maxSteps ?? 40 };
    __privateSet(this, _llm, new LLM(this.config));
    this.tools = new Map(tools);
    this.pageController = config.pageController;
    __privateGet(this, _llm).addEventListener("retry", (e) => {
      const { attempt, maxAttempts } = e.detail;
      __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, { type: "retrying", attempt, maxAttempts });
      this.history.push({
        type: "retry",
        message: `LLM retry attempt ${attempt} of ${maxAttempts}`,
        attempt,
        maxAttempts
      });
      __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
    });
    __privateGet(this, _llm).addEventListener("error", (e) => {
      const error = e.detail.error;
      if (error?.rawError?.name === "AbortError") return;
      const message = String(error);
      __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, { type: "error", message });
      this.history.push({
        type: "error",
        message,
        rawResponse: error.rawResponse
      });
      __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
    });
    if (this.config.customTools) {
      for (const [name, tool2] of Object.entries(this.config.customTools)) {
        if (tool2 === null) {
          this.tools.delete(name);
          continue;
        }
        this.tools.set(name, tool2);
      }
    }
    if (!this.config.experimentalScriptExecutionTool) {
      this.tools.delete("execute_javascript");
    }
  }
  /** Get current agent status */
  get status() {
    return __privateGet(this, _status);
  }
  /**
   * Push an observation message to the history event stream.
   * This will be visible in <agent_history> and remain persistent in memory across steps.
   * @experimental @internal
   * @note history change will be emitted before next step starts
   */
  pushObservation(content) {
    __privateGet(this, _observations).push(content);
  }
  /** Stop the current task. Agent remains reusable. */
  stop() {
    this.pageController.cleanUpHighlights();
    this.pageController.hideMask();
    __privateGet(this, _abortController).abort();
  }
  async execute(task) {
    if (this.disposed) throw new Error("PageAgent has been disposed. Create a new instance.");
    if (!task) throw new Error("Task is required");
    this.task = task;
    this.taskId = uid();
    if (!this.onAskUser) {
      this.tools.delete("ask_user");
    }
    const onBeforeStep = this.config.onBeforeStep;
    const onAfterStep = this.config.onAfterStep;
    const onBeforeTask = this.config.onBeforeTask;
    const onAfterTask = this.config.onAfterTask;
    await onBeforeTask?.(this);
    await this.pageController.showMask();
    if (__privateGet(this, _abortController)) {
      __privateGet(this, _abortController).abort();
      __privateSet(this, _abortController, new AbortController());
    }
    this.history = [];
    __privateMethod(this, _PageAgentCore_instances, setStatus_fn).call(this, "running");
    __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
    __privateSet(this, _observations, []);
    __privateSet(this, _states, { totalWaitTime: 0, lastURL: "", browserState: null });
    let step = 0;
    while (true) {
      try {
        console.group(`step: ${step}`);
        await onBeforeStep?.(this, step);
        console.log(chalk.blue.bold("👀 Observing..."));
        __privateGet(this, _states).browserState = await this.pageController.getBrowserState();
        await __privateMethod(this, _PageAgentCore_instances, handleObservations_fn).call(this, step);
        const messages = [
          { role: "system", content: __privateMethod(this, _PageAgentCore_instances, getSystemPrompt_fn).call(this) },
          { role: "user", content: await __privateMethod(this, _PageAgentCore_instances, assembleUserPrompt_fn).call(this) }
        ];
        const macroTool = { AgentOutput: __privateMethod(this, _PageAgentCore_instances, packMacroTool_fn).call(this) };
        console.log(chalk.blue.bold("🧠 Thinking..."));
        __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, { type: "thinking" });
        const result = await __privateGet(this, _llm).invoke(messages, macroTool, __privateGet(this, _abortController).signal, {
          toolChoiceName: "AgentOutput",
          normalizeResponse: /* @__PURE__ */ __name((res) => normalizeResponse(res, this.tools), "normalizeResponse")
        });
        const macroResult = result.toolResult;
        const input = macroResult.input;
        const output = macroResult.output;
        const reflection = {
          evaluation_previous_goal: input.evaluation_previous_goal,
          memory: input.memory,
          next_goal: input.next_goal
        };
        const actionName = Object.keys(input.action)[0];
        const action = {
          name: actionName,
          input: input.action[actionName],
          output
        };
        this.history.push({
          type: "step",
          stepIndex: step,
          reflection,
          action,
          usage: result.usage,
          rawResponse: result.rawResponse,
          rawRequest: result.rawRequest
        });
        __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
        await onAfterStep?.(this, this.history);
        console.groupEnd();
        if (actionName === "done") {
          const success = action.input?.success ?? false;
          const text = action.input?.text || "no text provided";
          console.log(chalk.green.bold("Task completed"), success, text);
          __privateMethod(this, _PageAgentCore_instances, onDone_fn).call(this, success);
          const result2 = {
            success,
            data: text,
            history: this.history
          };
          await onAfterTask?.(this, result2);
          return result2;
        }
      } catch (error) {
        console.groupEnd();
        const isAbortError = error?.rawError?.name === "AbortError";
        console.error("Task failed", error);
        const errorMessage = isAbortError ? "Task stopped" : String(error);
        __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, { type: "error", message: errorMessage });
        this.history.push({ type: "error", message: errorMessage, rawResponse: error });
        __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
        __privateMethod(this, _PageAgentCore_instances, onDone_fn).call(this, false);
        const result = {
          success: false,
          data: errorMessage,
          history: this.history
        };
        await onAfterTask?.(this, result);
        return result;
      }
      step++;
      if (step > this.config.maxSteps) {
        const errorMessage = "Step count exceeded maximum limit";
        this.history.push({ type: "error", message: errorMessage });
        __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
        __privateMethod(this, _PageAgentCore_instances, onDone_fn).call(this, false);
        const result = {
          success: false,
          data: errorMessage,
          history: this.history
        };
        await onAfterTask?.(this, result);
        return result;
      }
      await waitFor(this.config.stepDelay ?? 0.4);
    }
  }
  dispose() {
    console.log("Disposing PageAgent...");
    this.disposed = true;
    this.pageController.dispose();
    __privateGet(this, _abortController).abort();
    this.dispatchEvent(new Event("dispose"));
    this.config.onDispose?.(this);
  }
};
_status = new WeakMap();
_llm = new WeakMap();
_abortController = new WeakMap();
_observations = new WeakMap();
_states = new WeakMap();
_PageAgentCore_instances = new WeakSet();
/** Emit statuschange event */
emitStatusChange_fn = /* @__PURE__ */ __name(function() {
  this.dispatchEvent(new Event("statuschange"));
}, "#emitStatusChange");
/** Emit historychange event */
emitHistoryChange_fn = /* @__PURE__ */ __name(function() {
  this.dispatchEvent(new Event("historychange"));
}, "#emitHistoryChange");
/**
 * Emit activity event - for transient UI feedback
 * @param activity - Current agent activity
 */
emitActivity_fn = /* @__PURE__ */ __name(function(activity) {
  this.dispatchEvent(new CustomEvent("activity", { detail: activity }));
}, "#emitActivity");
/** Update status and emit event */
setStatus_fn = /* @__PURE__ */ __name(function(status) {
  if (__privateGet(this, _status) !== status) {
    __privateSet(this, _status, status);
    __privateMethod(this, _PageAgentCore_instances, emitStatusChange_fn).call(this);
  }
}, "#setStatus");
/**
 * Merge all tools into a single MacroTool with the following input:
 * - thinking: string
 * - evaluation_previous_goal: string
 * - memory: string
 * - next_goal: string
 * - action: { toolName: toolInput }
 * where action must be selected from tools defined in this.tools
 */
packMacroTool_fn = /* @__PURE__ */ __name(function() {
  const tools2 = this.tools;
  const actionSchemas = Array.from(tools2.entries()).map(([toolName, tool2]) => {
    return z.object({ [toolName]: tool2.inputSchema }).describe(tool2.description);
  });
  const actionSchema = z.union(actionSchemas);
  const macroToolSchema = z.object({
    // thinking: z.string().optional(),
    evaluation_previous_goal: z.string().optional(),
    memory: z.string().optional(),
    next_goal: z.string().optional(),
    action: actionSchema
  });
  return {
    description: "You MUST call this tool every step!",
    inputSchema: macroToolSchema,
    execute: /* @__PURE__ */ __name(async (input) => {
      if (__privateGet(this, _abortController).signal.aborted) throw new Error("AbortError");
      console.log(chalk.blue.bold("MacroTool input"), input);
      const action = input.action;
      const toolName = Object.keys(action)[0];
      const toolInput = action[toolName];
      const reflectionLines = [];
      if (input.evaluation_previous_goal)
        reflectionLines.push(`✅: ${input.evaluation_previous_goal}`);
      if (input.memory) reflectionLines.push(`💾: ${input.memory}`);
      if (input.next_goal) reflectionLines.push(`🎯: ${input.next_goal}`);
      const reflectionText = reflectionLines.length > 0 ? reflectionLines.join("\n") : "";
      if (reflectionText) {
        console.log(reflectionText);
      }
      const tool2 = tools2.get(toolName);
      assert(tool2, `Tool ${toolName} not found`);
      console.log(chalk.blue.bold(`Executing tool: ${toolName}`), toolInput);
      __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, { type: "executing", tool: toolName, input: toolInput });
      const startTime = Date.now();
      const result = await tool2.execute.bind(this)(toolInput);
      const duration = Date.now() - startTime;
      console.log(chalk.green.bold(`Tool (${toolName}) executed for ${duration}ms`), result);
      __privateMethod(this, _PageAgentCore_instances, emitActivity_fn).call(this, {
        type: "executed",
        tool: toolName,
        input: toolInput,
        output: result,
        duration
      });
      if (toolName === "wait") {
        __privateGet(this, _states).totalWaitTime += toolInput?.seconds || 0;
      } else {
        __privateGet(this, _states).totalWaitTime = 0;
      }
      return {
        input,
        output: result
      };
    }, "execute")
  };
}, "#packMacroTool");
/**
 * Get system prompt, dynamically replace language settings based on configured language
 */
getSystemPrompt_fn = /* @__PURE__ */ __name(function() {
  if (this.config.customSystemPrompt) {
    return this.config.customSystemPrompt;
  }
  const targetLanguage = this.config.language === "zh-CN" ? "中文" : "English";
  const systemPrompt = SYSTEM_PROMPT.replace(
    /Default working language: \*\*.*?\*\*/,
    `Default working language: **${targetLanguage}**`
  );
  return systemPrompt;
}, "#getSystemPrompt");
getInstructions_fn = /* @__PURE__ */ __name(async function() {
  const { instructions, experimentalLlmsTxt } = this.config;
  const systemInstructions = instructions?.system?.trim();
  let pageInstructions;
  const url = __privateGet(this, _states).browserState?.url || "";
  if (instructions?.getPageInstructions && url) {
    try {
      pageInstructions = instructions.getPageInstructions(url)?.trim();
    } catch (error) {
      console.error(
        chalk.red("[PageAgent] Failed to execute getPageInstructions callback:"),
        error
      );
    }
  }
  const llmsTxt = experimentalLlmsTxt && url ? await fetchLlmsTxt(url) : void 0;
  if (!systemInstructions && !pageInstructions && !llmsTxt) return "";
  let result = "<instructions>\n";
  if (systemInstructions) {
    result += `<system_instructions>
${systemInstructions}
</system_instructions>
`;
  }
  if (pageInstructions) {
    result += `<page_instructions>
${pageInstructions}
</page_instructions>
`;
  }
  if (llmsTxt) {
    result += `<llms_txt>
${llmsTxt}
</llms_txt>
`;
  }
  result += "</instructions>\n\n";
  return result;
}, "#getInstructions");
handleObservations_fn = /* @__PURE__ */ __name(async function(step) {
  if (__privateGet(this, _states).totalWaitTime >= 3) {
    this.pushObservation(
      `You have waited ${__privateGet(this, _states).totalWaitTime} seconds accumulatively. DO NOT wait any longer unless you have a good reason.`
    );
  }
  const currentURL = __privateGet(this, _states).browserState?.url || "";
  if (currentURL !== __privateGet(this, _states).lastURL) {
    this.pushObservation(`Page navigated to → ${currentURL}`);
    __privateGet(this, _states).lastURL = currentURL;
    await waitFor(0.5);
  }
  const remaining = this.config.maxSteps - step;
  if (remaining === 5) {
    this.pushObservation(
      `⚠️ Only ${remaining} steps remaining. Consider wrapping up or calling done with partial results.`
    );
  } else if (remaining === 2) {
    this.pushObservation(
      `⚠️ Critical: Only ${remaining} steps left! You must finish the task or call done immediately.`
    );
  }
  if (__privateGet(this, _observations).length > 0) {
    for (const content of __privateGet(this, _observations)) {
      this.history.push({ type: "observation", content });
      console.log(chalk.cyan("Observation:"), content);
    }
    __privateSet(this, _observations, []);
    __privateMethod(this, _PageAgentCore_instances, emitHistoryChange_fn).call(this);
  }
}, "#handleObservations");
assembleUserPrompt_fn = /* @__PURE__ */ __name(async function() {
  const browserState = __privateGet(this, _states).browserState;
  let prompt = "";
  prompt += await __privateMethod(this, _PageAgentCore_instances, getInstructions_fn).call(this);
  const stepCount = this.history.filter((e) => e.type === "step").length;
  prompt += "<agent_state>\n";
  prompt += "<user_request>\n";
  prompt += `${this.task}
`;
  prompt += "</user_request>\n";
  prompt += "<step_info>\n";
  prompt += `Step ${stepCount + 1} of ${this.config.maxSteps} max possible steps
`;
  prompt += `Current time: ${(/* @__PURE__ */ new Date()).toLocaleString()}
`;
  prompt += "</step_info>\n";
  prompt += "</agent_state>\n\n";
  prompt += "<agent_history>\n";
  let stepIndex = 0;
  for (const event of this.history) {
    if (event.type === "step") {
      stepIndex++;
      prompt += `<step_${stepIndex}>
`;
      prompt += `Evaluation of Previous Step: ${event.reflection.evaluation_previous_goal}
`;
      prompt += `Memory: ${event.reflection.memory}
`;
      prompt += `Next Goal: ${event.reflection.next_goal}
`;
      prompt += `Action Results: ${event.action.output}
`;
      prompt += `</step_${stepIndex}>
`;
    } else if (event.type === "observation") {
      prompt += `<sys>${event.content}</sys>
`;
    } else if (event.type === "user_takeover") {
      prompt += `<sys>User took over control and made changes to the page</sys>
`;
    } else if (event.type === "error") ;
  }
  prompt += "</agent_history>\n\n";
  let pageContent = browserState.content;
  if (this.config.transformPageContent) {
    pageContent = await this.config.transformPageContent(pageContent);
  }
  prompt += "<browser_state>\n";
  prompt += browserState.header + "\n";
  prompt += pageContent + "\n";
  prompt += browserState.footer + "\n\n";
  prompt += "</browser_state>\n\n";
  return prompt;
}, "#assembleUserPrompt");
onDone_fn = /* @__PURE__ */ __name(function(success = true) {
  this.pageController.cleanUpHighlights();
  this.pageController.hideMask();
  __privateMethod(this, _PageAgentCore_instances, setStatus_fn).call(this, success ? "completed" : "error");
  __privateGet(this, _abortController).abort();
}, "#onDone");
__name(_PageAgentCore, "PageAgentCore");
let PageAgentCore = _PageAgentCore;
export {
  PageAgentCore,
  tool
};
//# sourceMappingURL=page-agent-core.js.map
