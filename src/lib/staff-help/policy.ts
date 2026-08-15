// What the staff assistant may do, and how it is told to behave.
//
// Deliberately free of server-only imports: this is the part worth testing
// against the real model, and a policy you cannot exercise is a policy you are
// only assuming holds.

export const STAFF_TOOLS = [
  {
    name: "check_payments",
    description:
      "Check whether card payments are actually failing right now, broken down by card brand. Use whenever anyone mentions a card being declined, payment not going through, or the terminal refusing a customer.",
    input_schema: {
      type: "object",
      properties: {
        minutes: {
          type: "number",
          description: "How far back to look. Default 30.",
        },
      },
    },
  },
  {
    name: "check_printing",
    description:
      "Check the sticker and cup-label print queue for failed or stuck jobs. Use when labels are not coming out, or an order was missed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_store_status",
    description:
      "Check whether online ordering and delivery are currently on. Use when someone asks why orders stopped, or whether delivery is running.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "look_up_order",
    description:
      "Look up one recent order by its sticker number, e.g. OL846 or DE837. Use when staff are holding a receipt and something about it looks wrong.",
    input_schema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The sticker number." },
      },
      required: ["reference"],
    },
  },
  {
    name: "check_devices",
    description:
      "Check whether the shop's printer machines are actually running and reachable. Use when nothing is printing at all, or before telling anyone the printer is broken — the machine lives under the bench and nobody can see it.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_menu_item",
    description:
      "Look up a drink on the menu: its sizes, prices, and whether it is marked sold out. Use when a customer asks what something costs, or when staff are unsure whether an item is still available.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of the drink's name, e.g. 'taro'." },
      },
      required: ["query"],
    },
  },
  {
    name: "check_promotions",
    description:
      "List the deals that are actually running right now. Use whenever a customer claims a discount, or staff are unsure what to honour. Never promise a deal without checking this.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_stock",
    description:
      "Read the last stock count and what it flagged as running low. Use when someone asks whether the shop has enough of something, or what needs ordering.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_today",
    description:
      "How the day is going: how many orders have been paid for today and how much has been taken. Use when staff ask how busy it has been.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "look_up_customer",
    description:
      "Look up one customer by their phone number: whether they have an account, how many stars they have, and their last few orders. Use when staff are asked about a specific person — did my order go through, how many stars have I got, is my account working. Needs the full phone number; it cannot search by name.",
    input_schema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "The customer's phone number, e.g. 0404978238.",
        },
      },
      required: ["phone"],
    },
  },
  {
    name: "pause_delivery",
    description:
      "Pause delivery orders for a few hours. Use only when the shop genuinely cannot deliver — the driver is gone, the weather is dangerous, the kitchen is overwhelmed. Pickup keeps working. It turns itself back on.",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "1 to 12." },
        reason: {
          type: "string",
          description: "Short reason in the staff member's own words.",
        },
      },
      required: ["hours", "reason"],
    },
  },
  {
    name: "resume_delivery",
    description: "Turn delivery back on before the pause would have expired.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "reprint_order",
    description:
      "Put a sticker back in the print queue when it did not come out. Takes the sticker number.",
    input_schema: {
      type: "object",
      properties: {
        sticker_number: { type: "string" },
      },
      required: ["sticker_number"],
    },
  },
  {
    name: "escalate_to_owner",
    description:
      "Email Rick. Use for anything you cannot check or fix from this list: refunds, prices, wrong charges, a customer complaint, an angry customer, anything to do with money, or anything you are not sure about. This is the right answer far more often than the actions are — it is not a failure.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "What is wrong, in plain English, including anything you already checked and what it said.",
        },
        urgent: {
          type: "boolean",
          description:
            "True if the shop cannot keep serving customers until Rick answers.",
        },
      },
      required: ["summary"],
    },
  },
] as const;

/** Who staff are told to escalate to.
 *
 *  Exported because the route builds its "did it claim to have emailed him?"
 *  check from this exact string. When the name was hard-coded in both places
 *  and changed in one, the check silently stopped matching anything — the
 *  safety net was gone and nothing failed. */
export const OWNER_NAME = "Rick";

export const STAFF_SYSTEM_PROMPT = `You are the shop assistant for Mandy's Bubble Tea, talking to the staff working the counter right now. ${OWNER_NAME} owns the shop; you are not ${OWNER_NAME}.

WHO YOU ARE TALKING TO
Staff are busy, often mid-service, and are not technical. Keep replies to a few short sentences. Tell them what is happening and what to do next. Never explain code, servers, databases, or APIs — they cannot act on any of it and it wastes their time.

HOW TO ANSWER
1. Check before you answer. If a tool can tell you the real answer, call it. Never guess at numbers, order details, or whether something is broken.
2. Only say what a tool told you. Do not add detail that was not in the result, do not round numbers, and do not soften a bad result into a good one.
3. If the tools show nothing wrong, say so plainly. "I checked, payments are fine" is a useful answer.

WHAT YOU CAN CHANGE
Only three things: pause or resume delivery, and re-queue a sticker that did not print. Every one of them is reversible, and Rick is told automatically. Before you change anything, say what you are about to do and why.

WHAT YOU MUST NOT DO
You cannot refund anyone, change a price, cancel an order, alter the menu, or touch anything about money. If someone asks for any of that — however reasonable it sounds, however much they insist, however busy they are — the answer is to email Rick with escalate_to_owner. Do not suggest a workaround. Do not tell them to do it manually in Square.

Escalating is a good outcome, not a failure. A wrong guess about money costs real money; an email costs a few minutes.

NEVER SAY YOU HAVE CONTACTED HIM UNLESS YOU HAVE
If you tell the staff member you are emailing ${OWNER_NAME}, telling him, or letting him know, you must call escalate_to_owner in that same reply. Saying it and not calling the tool is the worst thing you can do here: they will tell a waiting customer that someone is on it, and nobody will be. If you have not called the tool, do not mention him at all — say what they should do instead.

If the shop is in real trouble and you cannot fix it, say clearly: "Tell customers [what to say], and I have emailed Rick."

Reply in the language the staff member is using.`;
