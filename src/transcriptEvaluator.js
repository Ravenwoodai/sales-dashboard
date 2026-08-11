"use strict";

const MISSING_VALUES = new Set(["", "NULL", "null", "None", "none", "NA", "N/A"]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isMissing(value) {
  return MISSING_VALUES.has(clean(value));
}

function toInt(value) {
  if (isMissing(value)) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function wordCount(text) {
  const matches = clean(text).match(/\b[\w']+\b/g);
  return matches ? matches.length : 0;
}

const SPEAKER_LABEL_PATTERN = /\b(?:Outbound call|Inbound call|Customer|Voicemail|Agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:?\s*/g;

function turnLabel(value) {
  return clean(value).replace(/:$/, "").trim();
}

function turnText(value) {
  return clean(value).replace(/^[\s\u2013\u2014-]+|[\s\u2013\u2014-]+$/g, "").trim();
}

function parseRawTranscriptTurns(text) {
  const source = clean(text).replace(/\s+/g, " ");
  if (!source) return [];

  SPEAKER_LABEL_PATTERN.lastIndex = 0;
  const matches = Array.from(source.matchAll(SPEAKER_LABEL_PATTERN));
  if (!matches.length) {
    return [{ speaker: "Transcript", originalSpeaker: "Transcript", text: source, labelStart: 0, start: 0, end: source.length }];
  }

  return matches.map((match, index) => {
    const next = matches[index + 1];
    const start = match.index + match[0].length;
    const end = next ? next.index : source.length;
    const speaker = turnLabel(match[0]);
    return {
      speaker,
      originalSpeaker: speaker,
      text: turnText(source.slice(start, end)),
      labelStart: match.index,
      start,
      end
    };
  }).filter((turn) => turn.text);
}

function isVoicemailSpeaker(speaker) {
  return clean(speaker).toLowerCase() === "voicemail";
}

function isSalespersonSpeaker(speaker) {
  const text = clean(speaker);
  return text === "Agent" || /\(CWA\)$/i.test(text);
}

const MACHINE_VOICEMAIL_PATTERNS = [
  /\byou have reached\b/i,
  /\bplease leave (?:a )?message\b/i,
  /\bleave (?:a )?message\b/i,
  /\bafter the tone\b/i,
  /\bmailbox\b/i,
  /\bmessage bank\b/i,
  /\brecord(?:ing)? (?:your )?message\b/i
];

const HUMAN_VOICEMAIL_DIALOGUE_PATTERNS = [
  /\b(?:i|i'm|i am|i'll|i will|i've|i have|me|my|we|we're|we are|we'll|we will|we've|our|us)\b/i,
  /\b(?:business|customers?|advertis(?:e|ing)|support|ready|busy|priorit(?:y|ies)|visibility|bandwidth|break|pause|capacity)\b/i,
  /\b(?:not right now|not now|can't|cannot|don't|do not|call you when|save your number|stay in touch)\b/i
];

const AI_VOICE_ASSISTANT_PATTERNS = [
  {
    pattern: /\bcall assistant recording this call\b/i,
    confidence: 0.96
  },
  {
    pattern: /\b(?:i['’]?m|i am)\s+(?:a|an)\s+(?:ai\s+)?call assistant\b/i,
    confidence: 0.94
  },
  {
    pattern: /\bplease say who you are and why you['’]?re calling\b/i,
    confidence: 0.92
  },
  {
    pattern: /\bthe person you['’]?re (?:calling|trying to reach) is busy\b/i,
    confidence: 0.9
  },
  {
    pattern: /\b(?:ai|virtual|digital) (?:call )?(?:assistant|receptionist)\b/i,
    confidence: 0.86
  },
  {
    pattern: /\b(?:google )?(?:assistant|screen(?:ing)? service) (?:is )?(?:recording|screening) (?:this )?call\b/i,
    confidence: 0.84
  },
  {
    pattern: /\bthis call is being screened\b/i,
    confidence: 0.82
  }
];

const AI_VOICE_ASSISTANT_EVIDENCE_PATTERNS = AI_VOICE_ASSISTANT_PATTERNS.map((item) => item.pattern);

const CALL_SCREENING_PATTERNS = [
  /\brecord your name and reason for calling\b/i,
  /\bi['’]?ll see if this person is available\b/i,
  /\bplease stay on the line\b/i,
  /\bif you record your name\b/i,
  /\bcall assistant recording this call\b/i,
  /\bplease say who you are and why you['’]?re calling\b/i
];

const CARRIER_SYSTEM_PATTERNS = [
  /\bthe number is busy\b/i,
  /\bnumber you have called\b/i,
  /\bcould not be connected\b/i,
  /\b(?:number|service) (?:has been|is) disconnected\b/i
];

function isMachineVoicemailTurn(turn) {
  const text = clean(turn?.text);
  return MACHINE_VOICEMAIL_PATTERNS.some((pattern) => pattern.test(text));
}

function isHumanLikeVoicemailTurn(turn) {
  if (!isVoicemailSpeaker(turn?.speaker)) return false;
  const text = clean(turn.text);
  if (!text || isMachineVoicemailTurn(turn)) return false;
  const words = wordCount(text);
  const signals = HUMAN_VOICEMAIL_DIALOGUE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  return words >= 12 && signals >= 1;
}

function hasAdjacentSalespersonTurn(turns, index) {
  const previous = turns[index - 1];
  const next = turns[index + 1];
  return isSalespersonSpeaker(previous?.speaker) || isSalespersonSpeaker(next?.speaker);
}

function hasHumanLikeVoicemailDialogueFromTurns(turns) {
  const salesTurns = turns.filter((turn) => isSalespersonSpeaker(turn.speaker));
  if (!salesTurns.length) return false;
  return turns.some((turn, index) => isHumanLikeVoicemailTurn(turn) && hasAdjacentSalespersonTurn(turns, index));
}

function normalizeHumanLikeVoicemailTurns(turns) {
  const shouldNormalize = hasHumanLikeVoicemailDialogueFromTurns(turns);
  return turns.map((turn) => ({
    ...turn,
    originalSpeaker: turn.originalSpeaker || turn.speaker,
    speaker: shouldNormalize && isVoicemailSpeaker(turn.speaker) ? "Customer" : turn.speaker
  }));
}

function parseTranscriptTurns(text) {
  return normalizeHumanLikeVoicemailTurns(parseRawTranscriptTurns(text));
}

function hasHumanLikeVoicemailDialogue(text) {
  return hasHumanLikeVoicemailDialogueFromTurns(parseRawTranscriptTurns(text));
}

function emptyAiVoiceAssistant() {
  return {
    detected: false,
    category: "none",
    confidence: null,
    responseClassification: "not_encountered",
    handledSuccessfully: null,
    bailed: null,
    responseWordCount: null,
    afterAssistantWordCount: null,
    tacticCount: null,
    tactics: {},
    tacticLabels: [],
    evidence: {
      text: "",
      turns: [],
      matchText: ""
    },
    followThrough: {
      status: "not_applicable",
      futureHumanContact: null,
      futureMeaningfulConversation: null,
      futureCallId: ""
    }
  };
}

function firstPatternMatch(source, definitions) {
  return definitions.reduce((best, definition) => {
    definition.pattern.lastIndex = 0;
    const match = definition.pattern.exec(source);
    if (!match) return best;
    if (!best || match.index < best.index) {
      return {
        definition,
        match,
        index: match.index,
        end: match.index + match[0].length
      };
    }
    return best;
  }, null);
}

function tacticResult(key, label, present) {
  return { key, label, present: Boolean(present) };
}

function detectAiVoiceAssistant(text) {
  const source = clean(text).replace(/\s+/g, " ");
  if (!source) return emptyAiVoiceAssistant();

  const firstMatch = firstPatternMatch(source, AI_VOICE_ASSISTANT_PATTERNS);
  if (!firstMatch) return emptyAiVoiceAssistant();

  const turns = parseRawTranscriptTurns(source);
  let assistantTurnIndex = turns.findIndex((turn) => firstPatternMatch(clean(turn.text), AI_VOICE_ASSISTANT_PATTERNS));
  if (assistantTurnIndex < 0) {
    assistantTurnIndex = turns.findIndex((turn) => firstMatch.index < turn.end && firstMatch.end > turn.labelStart);
  }

  const salespersonTurns = turns.filter((turn) => isSalespersonSpeaker(turn.speaker));
  const afterAssistantTurns = assistantTurnIndex >= 0
    ? turns.slice(assistantTurnIndex + 1).filter((turn) => isSalespersonSpeaker(turn.speaker))
    : [];
  const responseTurns = afterAssistantTurns.length ? afterAssistantTurns : salespersonTurns;
  const allSalespersonText = salespersonTurns.map((turn) => turn.text).join(" ");
  const responseText = responseTurns.map((turn) => turn.text).join(" ");
  const afterAssistantText = afterAssistantTurns.map((turn) => turn.text).join(" ");
  const responseWordCount = wordCount(responseText);
  const afterAssistantWordCount = wordCount(afterAssistantText);

  const tacticChecks = [
    tacticResult("stated_name", "Stated name", /\b(?:it['’]?s|it is|this is|my name is|speaking)\s+(?:just\s+)?[a-z][a-z' -]{1,40}\b/i.test(allSalespersonText)),
    tacticResult("mentioned_company", "Mentioned company", /\b(?:countrywide|countrywide austral|cwa)\b/i.test(allSalespersonText)),
    tacticResult("explained_reason", "Explained reason", /\b(?:reason (?:for|of) (?:my|the) call|calling (?:about|regarding)|official journal|local area|community|support|advertis(?:e|ing)|publication|sponsorship|campaign)\b/i.test(allSalespersonText)),
    tacticResult("asked_for_callback", "Asked for callback", /\b(?:call|ring|phone|get back to) (?:me|us) back\b|\bgive (?:me|us) a call\b|\breturn (?:my|our) call\b/i.test(allSalespersonText)),
    tacticResult("left_contact_detail", "Left contact detail", /\b(?:my|our) (?:number|mobile|phone)\b|\breach (?:me|us) (?:on|at)\b|\b0\d(?:[\s.-]?\d){7,}\b/i.test(allSalespersonText)),
    tacticResult("answered_prompt", "Answered assistant prompt", responseWordCount >= 12),
    tacticResult("kept_message_concise", "Kept message concise", responseWordCount >= 8 && responseWordCount <= 80)
  ];
  const tactics = tacticChecks.reduce((result, item) => {
    result[item.key] = item.present;
    return result;
  }, {});
  const tacticLabels = tacticChecks.filter((item) => item.present).map((item) => item.label);
  const tacticCount = tacticLabels.length;
  const explainedAndIdentified = tactics.explained_reason && (
    tactics.stated_name ||
    tactics.mentioned_company ||
    tactics.asked_for_callback ||
    tactics.left_contact_detail ||
    tactics.answered_prompt
  );
  const handledSuccessfully = tacticCount >= 3 || explainedAndIdentified || (tactics.asked_for_callback && responseWordCount >= 8);
  const bailed = !handledSuccessfully && (
    afterAssistantWordCount < 8 ||
    (!tactics.explained_reason && !tactics.asked_for_callback && !tactics.left_contact_detail)
  );

  const evidence = evidenceFor(source, AI_VOICE_ASSISTANT_EVIDENCE_PATTERNS, "AI call assistant language detected.");
  return {
    detected: true,
    category: "ai_call_assistant",
    confidence: firstMatch.definition.confidence,
    responseClassification: handledSuccessfully ? "handled_well" : bailed ? "bailed" : "partial",
    handledSuccessfully,
    bailed,
    responseWordCount,
    afterAssistantWordCount,
    tacticCount,
    tactics,
    tacticLabels,
    evidence,
    followThrough: {
      status: "pending",
      futureHumanContact: false,
      futureMeaningfulConversation: false,
      futureCallId: ""
    }
  };
}

function turnsAroundMatch(source, matchStart, matchEnd) {
  const turns = parseTranscriptTurns(source);
  if (turns.length <= 1 && turns[0]?.speaker === "Transcript") return [];

  const matchedIndex = turns.findIndex((turn) => matchStart < turn.end && matchEnd > turn.labelStart);
  if (matchedIndex < 0) return [];

  const start = Math.max(0, matchedIndex - 1);
  const end = Math.min(turns.length, matchedIndex + 2);
  return turns.slice(start, end).map((turn) => ({
    speaker: turn.speaker,
    text: turn.text,
    matched: matchStart < turn.end && matchEnd > turn.labelStart
  }));
}

function sentenceExcerpt(source, matchStart, matchEnd) {
  if (!source) return "";

  let start = Math.max(0, matchStart - 180);
  const prefix = source.slice(0, matchStart);
  const punctuationStart = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("? "), prefix.lastIndexOf("! "));
  if (punctuationStart >= start) {
    start = punctuationStart + 2;
  } else if (start > 0) {
    const nextSpace = source.indexOf(" ", start);
    start = nextSpace >= 0 && nextSpace < matchStart ? nextSpace + 1 : start;
  }

  let end = Math.min(source.length, matchEnd + 220);
  const suffix = source.slice(matchEnd, end);
  const punctuationEnd = suffix.search(/[.!?](?:\s|$)/);
  if (punctuationEnd >= 0) {
    end = matchEnd + punctuationEnd + 1;
  } else if (end < source.length) {
    const previousSpace = source.lastIndexOf(" ", end);
    if (previousSpace > matchEnd) end = previousSpace;
  }

  return source.slice(start, end).trim();
}

function formatTurns(turns) {
  return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join(" ");
}

function evidenceFor(text, patterns, fallback = "") {
  const source = clean(text).replace(/\s+/g, " ");
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = source.match(pattern);
    if (match && match.index !== undefined) {
      const start = match.index;
      const end = match.index + match[0].length;
      const turns = turnsAroundMatch(source, start, end);
      return {
        text: formatTurns(turns) || sentenceExcerpt(source, start, end),
        turns,
        matchText: clean(match[0])
      };
    }
  }
  return {
    text: fallback,
    turns: [],
    matchText: ""
  };
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function systemAudioSubtypeFor({ aiVoiceAssistant, carrierSystem, systemAudio, voicemail }) {
  const callScreening = Boolean(aiVoiceAssistant?.detected);

  if (callScreening) {
    return {
      detected: true,
      subtype: "call_screening",
      label: "Call Screening / AI Assistant",
      category: "screening"
    };
  }
  if (carrierSystem) {
    return {
      detected: true,
      subtype: "carrier_phone_system",
      label: "Carrier / Phone System",
      category: "carrier"
    };
  }
  if (voicemail) {
    return {
      detected: true,
      subtype: "machine_voicemail",
      label: "Machine Voicemail",
      category: "voicemail"
    };
  }
  if (systemAudio) {
    return {
      detected: true,
      subtype: "ambiguous_system_audio",
      label: "Ambiguous System Audio",
      category: "ambiguous"
    };
  }
  return {
    detected: false,
    subtype: "none",
    label: "None",
    category: "none"
  };
}

function followUpSummary(channel) {
  if (channel === "quote") return "Customer asked about quote, price, or cost";
  if (channel === "email_or_sms") return "Customer asked for information by email or SMS";
  if (channel === "meeting") return "Meeting or appointment signal found";
  if (channel === "call") return "Callback requested or promised";
  if (channel === "future_nurture") return "Long-term deferral or future nurture signal";
  return "Positive follow-up signal found";
}

function evidenceItem(signal, summary, proof, confidence) {
  return {
    signal,
    summary,
    text: proof.text,
    turns: proof.turns,
    matchText: proof.matchText,
    confidence
  };
}

const PATTERNS = {
  noAnswer: [
    /^\s*\[no answer\b/i,
    /not connected or rang out/i,
    /no speech detected/i,
    /\bdid not answer\b/i,
    /\bno answer\b/i
  ],
  voicemail: [
    /\bvoicemail\s*:/i,
    /\bvoicemail\b/i,
    /\bmessage bank\b/i,
    /\bleave (?:a )?message\b/i,
    /\bafter the tone\b/i,
    /\bmailbox\b/i
  ],
  systemAudio: [
    /\bthe number is busy\b/i,
    /\bnumber you have called\b/i,
    /\bthis person is not available\b/i,
    /\bcall assistant recording this call\b/i,
    /\bcould not be connected\b/i,
    /\bdisconnected\b/i
  ],
  wrongNumber: [
    /\bwrong number\b/i,
    /\byou(?:'| a)?ve got the wrong\b/i,
    /\bdon't know (?:who|what|that)\b/i,
    /\bno one here\b/i
  ],
  notInterested: [
    /\bnot interested\b/i,
    /\bno thanks\b/i,
    /\bno thank you\b/i,
    /\bdon't need\b/i,
    /\bdo not need\b/i,
    /\bnot right now\b/i
  ],
  callback: [
    /\bcall me back\b/i,
    /\bcall back\b/i,
    /\bring me\b/i,
    /\bring back\b/i,
    /\btry me\b/i,
    /\bafter (?:three|3|four|4|five|5)\b/i,
    /\btomorrow\b/i,
    /\blater (?:today|this afternoon|tonight)\b/i,
    /\bcall (?:me|us|them|him|her|you)?\s*back later\b/i,
    /\bring (?:me|us|them|him|her|you)?\s*back later\b/i,
    /\bnot now\b/i,
    /\btoo busy\b/i
  ],
  longTermDeferral: [
    /\b(?:call|ring|phone|get back to|try|contact|reach)\s+(?:me|us|him|her|them|the owner|the boss)?\s*(?:back|again)?\s*(?:in|after|within)?\s*(?:about|around|roughly)?\s*(?:12|twelve)\s+months?(?:'?\s*time)?\b/i,
    /\b(?:in|after|within)\s+(?:about|around|roughly)?\s*(?:12|twelve)\s+months?(?:'?\s*time)?\b/i,
    /\b(?:in|after|within)\s+(?:(?:about|around|roughly|approximately|maybe)\s+)?(?:a|one)\s+year(?:'s)?(?:\s+time)?\b/i,
    /\bnext financial year\b/i,
    /\bbefore (?:the )?next financial year\b/i,
    /\b(?:try|call|ring|contact|get back to|reach)\s+(?:me|us|him|her|them)?\s*(?:again|back)?\s+(?:this time )?next year\b/i,
    /\bthis time next year\b/i
  ],
  emailOrSms: [
    /\bsend (?:me )?(?:an )?email\b/i,
    /\bemail (?:me|through|it)\b/i,
    /\bsend (?:me )?(?:the )?(?:info|information|details)\b/i,
    /\btext (?:me|it)\b/i,
    /\bsms\b/i
  ],
  quote: [
    /\bquote\b/i,
    /\bquoted\b/i,
    /\bpricing\b/i,
    /\bprice\b/i,
    /\bcost\b/i
  ],
  appointment: [
    /\bappointment\b/i,
    /\bmeeting\b/i,
    /\bbook (?:it|me|a time)\b/i,
    /\bschedule\b/i
  ],
  positiveInterest: [
    /\binterested\b/i,
    /\bsounds good\b/i,
    /\byes please\b/i,
    /\btell me more\b/i,
    /\bsend (?:it|that|through)\b/i,
    /\bgo ahead\b/i
  ],
  complaint: [
    /\bcomplaint\b/i,
    /\bcomplain\b/i,
    /\bscam\b/i,
    /\bfraud\b/i,
    /\bharass/i,
    /\breport(?:ed|ing)?\b/i
  ],
  optOut: [
    /\bdo not call\b/i,
    /\bdon't call\b/i,
    /\bremove me\b/i,
    /\btake me off\b/i,
    /\bopt out\b/i,
    /\bunsubscribe\b/i
  ],
  speakerLabel: [
    /\bcustomer\s*:/i,
    /\bvoicemail\s*:/i,
    /\boutbound call\b/i,
    /\binbound call\b/i
  ]
};

const DIRECT_CUSTOMER_WRONG_NUMBER_PATTERNS = [
  /\b(?:you(?:'| a)?ve got|this is|that is) (?:the )?wrong number\b/i,
  /\bwrong number\b/i
];

const DIRECT_CUSTOMER_NOT_INTERESTED_PATTERNS = [
  /\bnot interested\b/i
];

function directCustomerProof(transcript, patterns) {
  const turns = parseRawTranscriptTurns(transcript);
  for (const turn of turns) {
    if (turnLabel(turn.speaker).toLowerCase() !== "customer") continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(turn.text);
      if (!match) continue;
      return {
        text: `Customer: ${turn.text}`,
        turns: [{ speaker: "Customer", text: turn.text, matched: true }],
        matchText: clean(match[0])
      };
    }
  }
  return null;
}

function literalTurnProof(transcript, patterns, allowedSpeakers) {
  const turns = parseRawTranscriptTurns(transcript);
  for (const turn of turns) {
    const speaker = turnLabel(turn.speaker).toLowerCase();
    if (!allowedSpeakers.has(speaker)) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(turn.text);
      if (!match) continue;
      return {
        text: `${turn.speaker}: ${turn.text}`,
        turns: [{ speaker: turn.speaker, text: turn.text, matched: true }],
        matchText: clean(match[0])
      };
    }
  }
  return null;
}

function explicitNoAnswerProof(transcript) {
  const source = clean(transcript).replace(/\s+/g, " ");
  const pattern = /^(?:outbound call\s*)?(?:\[\s*)?(?:no answer|no speech detected|not connected or rang out)(?:\s*\])?[.!]?$/i;
  const match = pattern.exec(source);
  if (!match) return null;
  return {
    text: source,
    turns: [],
    matchText: clean(match[0])
  };
}

function explicitMachineVoicemailProof(transcript) {
  return literalTurnProof(
    transcript,
    MACHINE_VOICEMAIL_PATTERNS,
    new Set(["voicemail", "transcript"])
  );
}

function explicitCarrierSystemProof(transcript) {
  return literalTurnProof(
    transcript,
    CARRIER_SYSTEM_PATTERNS,
    new Set(["voicemail", "transcript"])
  );
}

function detectLiteralAiVoiceAssistant(transcript) {
  const proof = literalTurnProof(
    transcript,
    [...AI_VOICE_ASSISTANT_EVIDENCE_PATTERNS, ...CALL_SCREENING_PATTERNS],
    new Set(["customer", "voicemail", "transcript"])
  );
  if (!proof) return emptyAiVoiceAssistant();
  return {
    ...emptyAiVoiceAssistant(),
    detected: true,
    category: "ai_call_assistant",
    responseClassification: "detected_unscored",
    evidence: proof,
    followThrough: {
      status: "not_evaluated",
      futureHumanContact: null,
      futureMeaningfulConversation: null,
      futureCallId: ""
    }
  };
}

function restrictedAiVoiceAssistant(aiVoiceAssistant) {
  if (!aiVoiceAssistant?.detected) return emptyAiVoiceAssistant();
  return {
    ...emptyAiVoiceAssistant(),
    detected: true,
    category: "ai_call_assistant",
    confidence: 0,
    responseClassification: "detected_unscored",
    evidence: aiVoiceAssistant.evidence,
    followThrough: {
      status: "not_evaluated",
      futureHumanContact: false,
      futureMeaningfulConversation: false,
      futureCallId: ""
    }
  };
}

function evaluateCall(row) {
  const transcript = clean(row.transcription_text);
  const transcriptAvailable = !isMissing(row.transcription_text);
  const durationSeconds = toInt(row.call_duration_seconds) || 0;
  const totalSeconds = toInt(row.CallTotalSeconds) || 0;
  const words = wordCount(transcript);
  const humanLikeVoicemailDialogue = transcriptAvailable && hasHumanLikeVoicemailDialogue(transcript);
  const speakerLabelsPresent = transcriptAvailable && hasAny(transcript, PATTERNS.speakerLabel);
  const aiVoiceAssistant = transcriptAvailable ? detectLiteralAiVoiceAssistant(transcript) : emptyAiVoiceAssistant();
  const noAnswerProof = transcriptAvailable ? explicitNoAnswerProof(transcript) : null;
  const voicemailProof = transcriptAvailable ? explicitMachineVoicemailProof(transcript) : null;
  const carrierSystemProof = transcriptAvailable ? explicitCarrierSystemProof(transcript) : null;
  const noAnswer = Boolean(noAnswerProof);
  const voicemail = Boolean(voicemailProof) && !humanLikeVoicemailDialogue;
  const systemAudio = Boolean(carrierSystemProof) || aiVoiceAssistant.detected;
  const systemAudioDetails = systemAudioSubtypeFor({
    aiVoiceAssistant,
    carrierSystem: Boolean(carrierSystemProof),
    systemAudio,
    voicemail
  });
  const wrongNumberProof = transcriptAvailable
    ? directCustomerProof(transcript, DIRECT_CUSTOMER_WRONG_NUMBER_PATTERNS)
    : null;
  const optOutProof = transcriptAvailable ? directCustomerProof(transcript, PATTERNS.optOut) : null;
  const notInterestedProof = transcriptAvailable
    ? directCustomerProof(transcript, DIRECT_CUSTOMER_NOT_INTERESTED_PATTERNS)
    : null;
  const wrongNumber = Boolean(wrongNumberProof);
  const optOut = Boolean(optOutProof);
  const notInterested = Boolean(notInterestedProof);

  const transcriptNull = !transcriptAvailable;
  const transcriptPlaceholder = noAnswer || /\bfailed transcription\b/i.test(transcript);
  const transcriptTooShort = transcriptAvailable && words < 12 && durationSeconds < 15;
  const transcriptSystemGenerated = noAnswer || systemAudio || voicemail;
  const telephonyConnected = durationSeconds > 0;

  let contactClassification = "unknown";
  if (noAnswer) contactClassification = "no_answer";
  else if (wrongNumber) contactClassification = "wrong_number";
  else if (systemAudio) contactClassification = "system_audio";
  else if (voicemail) contactClassification = "voicemail";

  let localOutcomeCategory = "unknown";
  if (contactClassification === "system_audio") localOutcomeCategory = "system_audio";
  else if (optOut) localOutcomeCategory = "opt_out";
  else if (wrongNumber) localOutcomeCategory = "wrong_number";
  else if (notInterested) localOutcomeCategory = "not_interested";
  else if (contactClassification === "no_answer") localOutcomeCategory = "no_answer";
  else if (contactClassification === "voicemail") localOutcomeCategory = "voicemail";

  const evidence = [];
  if (noAnswerProof) {
    evidence.push(evidenceItem(
      "literal_no_answer",
      "Exact no-answer system marker found",
      noAnswerProof,
      0
    ));
  }
  if (voicemailProof && voicemail) {
    evidence.push(evidenceItem(
      "literal_machine_voicemail",
      "Explicit machine-voicemail wording found in system-labelled audio",
      voicemailProof,
      0
    ));
  }
  if (carrierSystemProof) {
    evidence.push(evidenceItem(
      "literal_carrier_system",
      "Canonical carrier-system wording found outside a customer or salesperson turn",
      carrierSystemProof,
      0
    ));
  }
  if (wrongNumberProof) {
    evidence.push(evidenceItem(
      "literal_wrong_number",
      "Direct customer wrong-number wording found",
      wrongNumberProof,
      0
    ));
  }
  if (optOutProof) {
    evidence.push(evidenceItem(
      "opt_out",
      "Direct customer opt-out wording found",
      optOutProof,
      0
    ));
  }
  if (notInterestedProof && !optOutProof) {
    evidence.push(evidenceItem(
      "literal_not_interested",
      "Direct customer not-interested wording found",
      notInterestedProof,
      0
    ));
  }
  if (aiVoiceAssistant.detected) {
    evidence.push(evidenceItem(
      "ai_voice_assistant",
      "AI call assistant literal phrase found; handling was not evaluated",
      aiVoiceAssistant.evidence,
      0
    ));
  }

  return {
    schemaVersion: "local_call_eval.v1",
    modelProvider: "deterministic-local-rules",
    rulesetVersion: "literal-triage-2026-07-22",
    processingStatus: "restricted_literal_only",
    authority: {
      status: "restricted",
      decisionUsePermitted: false,
      permittedUse: "Literal machine/no-answer/voicemail, direct-customer wrong-number, direct-customer not-interested, and direct-customer opt-out triage only.",
      prohibitedUse: "Semantic outcomes, follow-up work, complaint findings, interest, quote, callback, quality, coaching, ranking, or performance decisions.",
      evidenceSource: "runtime/ALL_EVALUATORS_ACCURACY_AUDIT_2026-07-20.md"
    },
    callId: clean(row.call_id),
    durationSeconds,
    totalSeconds,
    transcript: {
      available: transcriptAvailable,
      wordCount: words,
      speakerLabelsPresent,
      usableForCoaching: false,
      qualityScore: 0,
      qualityBand: "unknown",
      nullFlag: transcriptNull,
      placeholderFlag: transcriptPlaceholder,
      systemGeneratedFlag: transcriptSystemGenerated,
      tooShortForAnalysisFlag: transcriptTooShort,
      humanLikeVoicemailDialogue
    },
    contact: {
      telephonyConnected,
      probableLiveHuman: null,
      meaningfulConversation: null,
      actionableConversation: null,
      classification: contactClassification,
      confidence: null,
      semanticStatus: "not_evaluated"
    },
    systemAudio: {
      ...systemAudioDetails,
      barrier: systemAudioDetails.detected,
      shouldTrackRecovery: false
    },
    opportunity: {
      positiveInterest: null,
      requestedCallback: null,
      longTermDeferral: null,
      requestedEmailOrSms: null,
      requestedQuote: null,
      appointmentOrMeeting: null,
      followUpRequired: null,
      followUpChannel: "not_evaluated",
      confidence: null,
      semanticStatus: "not_evaluated"
    },
    risk: {
      complaint: null,
      optOut,
      reviewRequired: optOut,
      severity: optOut ? "high" : "none",
      confidence: null,
      semanticStatus: "literal_opt_out_only"
    },
    outcome: {
      localCategory: localOutcomeCategory,
      reviewRequired: optOut,
      confidence: null,
      semanticStatus: ["wrong_number", "not_interested", "opt_out", "no_answer", "voicemail", "system_audio"].includes(localOutcomeCategory)
        ? "restricted_literal"
        : "not_evaluated"
    },
    coaching: {
      missedFollowUpOpportunity: null,
      lowCustomerEngagement: null,
      confidence: null,
      semanticStatus: "not_evaluated"
    },
    aiVoiceAssistant,
    evidence,
    preview: transcript.slice(0, 260)
  };
}

module.exports = {
  clean,
  isMissing,
  toInt,
  evaluateCall,
  parseTranscriptTurns
};
