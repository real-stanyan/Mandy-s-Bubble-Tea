// Minimal type surface for the Square Web Payments SDK (window.Square).
// Used by both checkout and the cart drawer's wallet quick-pay.

export type TokenizeResult = {
  status: "OK" | "Invalid" | "Cancel" | string;
  token?: string;
  errors?: { message: string }[];
};

export type CardInstance = {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<TokenizeResult>;
  destroy(): Promise<void>;
};

export type ApplePayInstance = {
  // Apple Pay has no attach() — it uses the native payment sheet.
  tokenize(): Promise<TokenizeResult>;
};

export type GooglePayInstance = {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<TokenizeResult>;
  destroy(): Promise<void>;
};

export type VerificationDetails = {
  amount: string;
  currencyCode: string;
  intent: "CHARGE" | "STORE";
  billingContact: {
    givenName?: string;
    familyName?: string;
    phone?: string;
    countryCode?: string;
  };
  customerInitiated: boolean;
  sellerKeyedIn: boolean;
};

export type PaymentsInstance = {
  card(): Promise<CardInstance>;
  applePay(paymentRequest: unknown): Promise<ApplePayInstance>;
  googlePay(paymentRequest: unknown): Promise<GooglePayInstance>;
  paymentRequest(config: {
    countryCode: string;
    currencyCode: string;
    total: { amount: string; label: string };
  }): unknown;
  verifyBuyer(
    source: string,
    details: VerificationDetails,
  ): Promise<{ token: string }>;
};

export type SquareGlobal = {
  payments(appId: string, locationId: string): PaymentsInstance;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}
