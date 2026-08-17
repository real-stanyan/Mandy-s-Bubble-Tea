"use client";

/** Chat UI chrome in the visitor's own language. The assistant itself
 *  answers in whatever language the customer types — this covers the
 *  fixed strings around it (labels, buttons, error copy), which used to
 *  be hardcoded Chinese on a Queensland storefront. Browser language is
 *  the only signal available before the customer has typed anything;
 *  zh-* gets the Chinese pack, everything else falls back to English. */
export type ChatUiStrings = {
  launcherLabel: string;
  launcherAria: string;
  teaser: string;
  teaserDismissAria: string;
  drawerTitle: string;
  closeAria: string;
  inputPlaceholder: string;
  send: string;
  emptyStateHint: string;
  thinking: string;
  rateLimited: string;
  networkError: string;
  addToCart: string;
  addedToCart: string;
  payNow: string;
  playAria: string;
  voiceOrder: string;
  voiceStop: string;
  addAllToCart: (cups: number) => string;
  cupsTotal: (cups: number) => string;
  checkoutEmptyCart: string;
  checkoutFeesNote: (cups: number) => string;
  goToCheckout: string;
  signInTitle: string;
  signInBody: string;
  signInCta: string;
  mysteryTap: string;
  mysteryTapAria: string;
  mysteryOpening: string;
  mysteryInRewards: string;
  mysteryExpires: (date: string) => string;
  mysteryAlready: string;
  mysterySignIn: string;
  mysteryError: string;
};

const ZH: ChatUiStrings = {
  launcherLabel: "Hi Mandy!",
  launcherAria: "打开 Mandy 点单助手",
  teaser: "嗨！我是 Mandy 🧋 帮你推荐、点单、有问必答～",
  teaserDismissAria: "关闭提示",
  drawerTitle: "点单助手",
  closeAria: "关闭",
  inputPlaceholder: "想喝点什么？",
  send: "发送",
  emptyStateHint: "想喝点什么？描述一下口味就行，比如「不太甜的芋头奶茶，去冰」。点单、问问题、有不满意的都可以说。",
  thinking: "正在想…",
  rateLimited: "聊天有点忙，过一会儿再试试，或者直接看菜单。",
  networkError: "网络好像出了点问题，再发一次试试？",
  addToCart: "加入购物车",
  addedToCart: "已加入购物车",
  payNow: "直接支付",
  playAria: "听 Mandy 说",
  voiceOrder: "语音点单",
  voiceStop: "说完了",
  addAllToCart: (cups) => `全部加入购物车 · ${cups} 杯`,
  cupsTotal: (cups) => `共 ${cups} 杯`,
  checkoutEmptyCart: "购物车还是空的——先挑一杯，或者直接跟我说想喝什么。",
  checkoutFeesNote: (cups) => `共 ${cups} 杯 · 优惠和费用在结账页计算`,
  goToCheckout: "去结账",
  signInTitle: "登录后可以查订单",
  signInBody: "登录你的账户，我就能帮你查订单状态、会员星星和专属优惠。",
  signInCta: "去登录",
  mysteryTap: "点我开盒 🎁",
  mysteryTapAria: "打开今天的盲盒",
  mysteryOpening: "开盒中…",
  mysteryInRewards: "已放进你的 Rewards",
  mysteryExpires: (date) => `${date} 前有效`,
  mysteryAlready: "今天已经开过啦，明天再来！",
  mysterySignIn: "登录后就能开今天的盲盒啦",
  mysteryError: "没开出来…再点一下试试",
};

const EN: ChatUiStrings = {
  launcherLabel: "Hi Mandy!",
  launcherAria: "Open Mandy, the order assistant",
  teaser: "Hi! I'm Mandy 🧋 — ask me for picks, orders, or help.",
  teaserDismissAria: "Dismiss",
  drawerTitle: "Order assistant",
  closeAria: "Close",
  inputPlaceholder: "What are you in the mood for?",
  send: "Send",
  emptyStateHint: "Tell me what you feel like — e.g. \"a taro milk tea, not too sweet, no ice\". Order, ask questions, or tell me if something went wrong.",
  thinking: "Thinking…",
  rateLimited: "The chat is a little busy — try again in a moment, or browse the menu.",
  networkError: "Network hiccup — try sending that again?",
  addToCart: "Add to cart",
  addedToCart: "Added to cart",
  payNow: "Pay now",
  playAria: "Hear Mandy say it",
  voiceOrder: "Voice order",
  voiceStop: "Done talking",
  addAllToCart: (cups) => `Add all to cart · ${cups} cups`,
  cupsTotal: (cups) => `${cups} cups`,
  checkoutEmptyCart: "Your cart is still empty — pick a drink, or just tell me what you feel like.",
  checkoutFeesNote: (cups) => `${cups} cup${cups === 1 ? "" : "s"} · discounts and fees are worked out at checkout`,
  goToCheckout: "Checkout",
  signInTitle: "Sign in to check your order",
  signInBody: "Once you're signed in I can look up your order status, loyalty stars and member offers.",
  signInCta: "Sign in",
  mysteryTap: "Tap to open 🎁",
  mysteryTapAria: "Open today's mystery box",
  mysteryOpening: "Opening…",
  mysteryInRewards: "Added to your Rewards",
  mysteryExpires: (date) => `valid until ${date}`,
  mysteryAlready: "Already opened today — come back tomorrow!",
  mysterySignIn: "Sign in to open today's box",
  mysteryError: "It didn't open… tap to try again",
};

export function chatUiStrings(): ChatUiStrings {
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
    return ZH;
  }
  return EN;
}
