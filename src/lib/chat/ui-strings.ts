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
  addAllToCart: (cups: number) => string;
  cupsTotal: (cups: number) => string;
  checkoutEmptyCart: string;
  checkoutFeesNote: (cups: number) => string;
  goToCheckout: string;
};

const ZH: ChatUiStrings = {
  launcherLabel: "点单助手",
  launcherAria: "打开点单助手",
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
  addAllToCart: (cups) => `全部加入购物车 · ${cups} 杯`,
  cupsTotal: (cups) => `共 ${cups} 杯`,
  checkoutEmptyCart: "购物车还是空的——先挑一杯，或者直接跟我说想喝什么。",
  checkoutFeesNote: (cups) => `共 ${cups} 杯 · 优惠和费用在结账页计算`,
  goToCheckout: "去结账",
};

const EN: ChatUiStrings = {
  launcherLabel: "Order assistant",
  launcherAria: "Open the order assistant",
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
  addAllToCart: (cups) => `Add all to cart · ${cups} cups`,
  cupsTotal: (cups) => `${cups} cups`,
  checkoutEmptyCart: "Your cart is still empty — pick a drink, or just tell me what you feel like.",
  checkoutFeesNote: (cups) => `${cups} cup${cups === 1 ? "" : "s"} · discounts and fees are worked out at checkout`,
  goToCheckout: "Checkout",
};

export function chatUiStrings(): ChatUiStrings {
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
    return ZH;
  }
  return EN;
}
