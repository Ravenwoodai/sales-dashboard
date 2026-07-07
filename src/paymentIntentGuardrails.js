function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const PAYMENT_ACTION_PATTERN = /\b(?:pay|paying|payment|paid|card|credit card|bank transfer|invoice|tax invoice|receipt|order|book|purchase|go ahead|sounds good|proceed|sign (?:me|us) up|put (?:me|us) down)\b/i;
const OFFER_CONTEXT_PATTERN = /\b(?:journal|publication|advertising|advertisement|advert|ad\b|campaign|sponsorship|sponsor|support|package|feature|listing|order|invoice|cause|charity|police|ses|ambulance|school|blue light)\b/i;
const UNRELATED_PAYMENT_PATTERN = /\bpay(?:ing|s|ed)?\s+(?:for\s+)?(?:my|our|the|a|an)?\s*(?:mortgage|rent|bills?|wages?|salary|staff|employees?|tax(?:es)?|fine|loan|debt|electricity|utilities|overheads?|insurance|lease|food|groceries|fuel)\b/i;
const BARE_PAYMENT_TOKEN_PATTERN = /^(?:pay|payment|card|order)$/i;

const EXPLICIT_ORDER_OR_BILLING_PATTERN = /\b(?:send (?:(?:me|us)\s+)?(?:an? |the )?(?:invoice|tax invoice|receipt)|(?:tax )?invoice|receipt|credit card|card details|bank transfer|payment details|take (?:my |the )?payment|process (?:my |the )?payment|pay for (?:it|that|this|the|your|our|journal|publication|advertising|advertisement|advert|ad|campaign|sponsorship|package|listing|order)|payment for (?:it|that|this|the|your|our|journal|publication|advertising|advertisement|advert|ad|campaign|sponsorship|package|listing|order)|place (?:an? |the |my |our )?order|order (?:it|that|this|the|a|an)|book it|book (?:that|this|the)|purchase (?:it|that|this|the)|put (?:me|us) down|sign (?:me|us) up)\b/i;
const WEAK_PROCEED_PATTERN = /\b(?:go ahead|sounds good|proceed)\b/i;
const OFFER_PAYMENT_LINK_PATTERN = /\b(?:pay|paying|payment|paid)\b.{0,90}\b(?:journal|publication|advertising|advertisement|advert|ad\b|campaign|sponsorship|package|listing|order|invoice)\b|\b(?:journal|publication|advertising|advertisement|advert|ad\b|campaign|sponsorship|package|listing|order|invoice)\b.{0,90}\b(?:pay|paying|payment|paid)\b/i;

function paymentIntentText(value = {}) {
  if (typeof value === "string") return cleanText(value);
  return cleanText([
    value.raw_value,
    value.rawValue,
    value.normalized_value,
    value.normalizedValue,
    value.evidence
  ].filter(Boolean).join(" "));
}

function isOfferPaymentOrOrderIntent(value = {}) {
  const text = paymentIntentText(value);
  if (!text || !PAYMENT_ACTION_PATTERN.test(text)) return false;

  const raw = cleanText(typeof value === "string" ? "" : value.raw_value || value.rawValue || "");
  const hasUnrelatedPaymentContext = UNRELATED_PAYMENT_PATTERN.test(text);
  const hasExplicitOrderOrBilling = EXPLICIT_ORDER_OR_BILLING_PATTERN.test(text);
  const hasOfferPaymentLink = OFFER_PAYMENT_LINK_PATTERN.test(text);
  const hasWeakProceed = WEAK_PROCEED_PATTERN.test(text);
  const hasOfferContext = OFFER_CONTEXT_PATTERN.test(text);

  if (hasUnrelatedPaymentContext && !hasExplicitOrderOrBilling) return false;
  if (BARE_PAYMENT_TOKEN_PATTERN.test(raw) && hasUnrelatedPaymentContext) return false;
  if (hasExplicitOrderOrBilling || hasOfferPaymentLink) return true;
  if (hasWeakProceed && hasOfferContext) return true;
  return false;
}

module.exports = {
  isOfferPaymentOrOrderIntent,
  paymentIntentText
};
