export const validateDescription = (description) => {
  if (!description) return false;

  const text = description.toLowerCase().trim();

  // 1️⃣ Too short → reject
  if (text.length < 5) return false;

  // 2️⃣ Garbage / test strings
  const blockedPatterns = [
    /^test+$/,
    /^hello+$/,
    /^hi+$/,
    /^asdf+/,
    /^random$/,
    /^nothing$/,
  ];

  if (blockedPatterns.some((p) => p.test(text))) {
    return false;
  }

  // 3️⃣ Civic keywords (MINIMUM ONE REQUIRED)
  const civicKeywords = [
    "road",
    "pothole",
    "garbage",
    "trash",
    "waste",
    "drain",
    "sewer",
    "water",
    "street",
    "light",
    "lamp",
    "electric",
    "overflow",
    "leak",
    "block",
    "damage",
    "broken",
    "repair",
    "smell",
    "flood",
    "mud",
    "dust",
    "signal",
    "traffic",
  ];

  const hasCivicKeyword = civicKeywords.some((k) =>
    text.includes(k)
  );

  return hasCivicKeyword;
};
