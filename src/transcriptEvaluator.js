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
  /\bnot available\b/i,
  /\bunavailable\b/i,
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
  /\bdisconnected\b/i,
  /\bthis person is not available\b/i,
  /\bnot available\b/i,
  /\bunavailable\b/i
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
    confidence: 0,
    responseClassification: "not_encountered",
    handledSuccessfully: false,
    bailed: false,
    responseWordCount: 0,
    afterAssistantWordCount: 0,
    tacticCount: 0,
    tactics: {},
    tacticLabels: [],
    evidence: {
      text: "",
      turns: [],
      matchText: ""
    },
    followThrough: {
      status: "not_applicable",
      futureHumanContact: false,
      futureMeaningfulConversation: false,
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

function systemAudioSubtypeFor({ transcript, aiVoiceAssistant, systemAudio, voicemail }) {
  const source = clean(transcript);
  const callScreening = aiVoiceAssistant?.detected || hasAny(source, CALL_SCREENING_PATTERNS);
  const carrierSystem = hasAny(source, CARRIER_SYSTEM_PATTERNS);

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

function evaluateCall(row) {
  const transcript = clean(row.transcription_text);
  const transcriptAvailable = !isMissing(row.transcription_text);
  const lowerTranscript = transcript.toLowerCase();
  const durationSeconds = toInt(row.call_duration_seconds) || 0;
  const totalSeconds = toInt(row.CallTotalSeconds) || 0;
  const words = wordCount(transcript);
  const humanLikeVoicemailDialogue = transcriptAvailable && hasHumanLikeVoicemailDialogue(transcript);
  const speakerLabelsPresent = transcriptAvailable && hasAny(transcript, PATTERNS.speakerLabel);
  const aiVoiceAssistant = transcriptAvailable ? detectAiVoiceAssistant(transcript) : emptyAiVoiceAssistant();

  const noAnswer = transcriptAvailable && hasAny(transcript, PATTERNS.noAnswer);
  const rawVoicemail = transcriptAvailable && hasAny(transcript, PATTERNS.voicemail);
  const voicemail = rawVoicemail && !humanLikeVoicemailDialogue;
  const systemAudio = transcriptAvailable && (hasAny(transcript, PATTERNS.systemAudio) || aiVoiceAssistant.detected);
  const systemAudioDetails = transcriptAvailable
    ? systemAudioSubtypeFor({ transcript, aiVoiceAssistant, systemAudio, voicemail })
    : systemAudioSubtypeFor({ transcript: "", aiVoiceAssistant, systemAudio: false, voicemail: false });
  const wrongNumber = transcriptAvailable && hasAny(transcript, PATTERNS.wrongNumber);
  const notInterested = transcriptAvailable && hasAny(transcript, PATTERNS.notInterested);
  const longTermDeferral = transcriptAvailable && hasAny(transcript, PATTERNS.longTermDeferral);
  const callback = transcriptAvailable && hasAny(transcript, PATTERNS.callback) && !longTermDeferral;
  const emailOrSms = transcriptAvailable && hasAny(transcript, PATTERNS.emailOrSms);
  const quote = transcriptAvailable && hasAny(transcript, PATTERNS.quote);
  const appointment = transcriptAvailable && hasAny(transcript, PATTERNS.appointment);
  const positiveInterest = transcriptAvailable && hasAny(transcript, PATTERNS.positiveInterest);
  const currentPositiveInterest = positiveInterest && !longTermDeferral;
  const complaint = transcriptAvailable && hasAny(transcript, PATTERNS.complaint);
  const optOut = transcriptAvailable && hasAny(transcript, PATTERNS.optOut);

  const transcriptNull = !transcriptAvailable;
  const transcriptPlaceholder = noAnswer || /\bfailed transcription\b/i.test(transcript);
  const transcriptTooShort = transcriptAvailable && words < 12 && durationSeconds < 15;
  const transcriptSystemGenerated = noAnswer || systemAudio || voicemail;
  const transcriptUsableForCoaching = transcriptAvailable && !transcriptPlaceholder && !transcriptTooShort && !voicemail && !systemAudio;
  const transcriptQualityScore = transcriptNull
    ? 0
    : Math.max(5, Math.min(100, 35 + Math.min(words, 120) * 0.4 + (speakerLabelsPresent ? 20 : 0) - (transcriptSystemGenerated ? 25 : 0)));
  const transcriptQualityBand = transcriptQualityScore >= 75 ? "high" : transcriptQualityScore >= 45 ? "medium" : transcriptQualityScore > 0 ? "low" : "unusable";

  const telephonyConnected = durationSeconds > 0;
  const noTranscriptNoPickup = !transcriptAvailable;
  const probableLiveHuman =
    transcriptAvailable &&
    !noAnswer &&
    !systemAudio &&
    !voicemail &&
    (wrongNumber || callback || emailOrSms || quote || appointment || positiveInterest || notInterested || complaint || optOut || (speakerLabelsPresent && words >= 16 && durationSeconds >= 10));
  const meaningfulConversation = probableLiveHuman && (words >= 35 || durationSeconds >= 30);
  const actionableConversation =
    meaningfulConversation && (callback || emailOrSms || quote || appointment || currentPositiveInterest || longTermDeferral || complaint || optOut || wrongNumber || notInterested);

  let contactClassification = "unknown";
  if (noAnswer || noTranscriptNoPickup) contactClassification = "no_answer";
  else if (wrongNumber) contactClassification = "wrong_number";
  else if (systemAudio) contactClassification = "system_audio";
  else if (voicemail) contactClassification = "voicemail";
  else if (probableLiveHuman) contactClassification = "customer";

  let localOutcomeCategory = "unknown";
  if (contactClassification === "system_audio" && !probableLiveHuman) localOutcomeCategory = "system_audio";
  else if (optOut) localOutcomeCategory = "opt_out";
  else if (complaint) localOutcomeCategory = "complaint";
  else if (wrongNumber) localOutcomeCategory = "wrong_number";
  else if (callback) localOutcomeCategory = "callback_requested";
  else if (quote) localOutcomeCategory = "quote_requested";
  else if (emailOrSms) localOutcomeCategory = "send_information";
  else if (appointment) localOutcomeCategory = "appointment_or_meeting";
  else if (longTermDeferral) localOutcomeCategory = "long_term_deferral";
  else if (currentPositiveInterest) localOutcomeCategory = "positive_interest";
  else if (notInterested) localOutcomeCategory = "not_interested";
  else if (contactClassification === "no_answer") localOutcomeCategory = "no_answer";
  else if (contactClassification === "voicemail") localOutcomeCategory = "voicemail";
  else if (meaningfulConversation) localOutcomeCategory = "other";

  const followUpRequired = callback || emailOrSms || quote || appointment || currentPositiveInterest;
  const followUpChannel = quote ? "quote" : emailOrSms ? "email_or_sms" : appointment ? "meeting" : callback ? "call" : followUpRequired ? "other" : "none";
  const reviewRequired = complaint || optOut || (transcriptAvailable && transcriptQualityBand === "low" && durationSeconds >= 30);
  const confidence = transcriptQualityBand === "high" ? 0.86 : transcriptQualityBand === "medium" ? 0.68 : transcriptQualityBand === "low" ? 0.42 : 0.12;

  const evidence = [];
  if (followUpRequired) {
    evidence.push(evidenceItem(
      "follow_up",
      followUpSummary(followUpChannel),
      evidenceFor(transcript, [...PATTERNS.callback, ...PATTERNS.emailOrSms, ...PATTERNS.quote, ...PATTERNS.appointment, ...PATTERNS.positiveInterest]),
      confidence
    ));
  }
  if (longTermDeferral && !followUpRequired) {
    evidence.push(evidenceItem(
      "long_term_deferral",
      followUpSummary("future_nurture"),
      evidenceFor(transcript, PATTERNS.longTermDeferral),
      confidence
    ));
  }
  if (complaint || optOut) {
    evidence.push(evidenceItem(
      complaint ? "complaint" : "opt_out",
      complaint ? "Complaint or risk wording found" : "Opt-out request found",
      evidenceFor(transcript, complaint ? PATTERNS.complaint : PATTERNS.optOut),
      confidence
    ));
  }
  if (aiVoiceAssistant.detected) {
    evidence.push(evidenceItem(
      "ai_voice_assistant",
      aiVoiceAssistant.handledSuccessfully
        ? "AI call assistant encountered; salesperson left a structured response"
        : aiVoiceAssistant.bailed
          ? "AI call assistant encountered; salesperson appears to have bailed"
          : "AI call assistant encountered",
      aiVoiceAssistant.evidence,
      aiVoiceAssistant.confidence
    ));
  }

  return {
    schemaVersion: "local_call_eval.v1",
    modelProvider: "deterministic-local-rules",
    rulesetVersion: "mvp-2026-07-05",
    processingStatus: "processed",
    callId: clean(row.call_id),
    durationSeconds,
    totalSeconds,
    transcript: {
      available: transcriptAvailable,
      wordCount: words,
      speakerLabelsPresent,
      usableForCoaching: transcriptUsableForCoaching,
      qualityScore: Math.round(transcriptQualityScore),
      qualityBand: transcriptQualityBand,
      nullFlag: transcriptNull,
      placeholderFlag: transcriptPlaceholder,
      systemGeneratedFlag: transcriptSystemGenerated,
      tooShortForAnalysisFlag: transcriptTooShort,
      humanLikeVoicemailDialogue
    },
    contact: {
      telephonyConnected,
      probableLiveHuman,
      meaningfulConversation,
      actionableConversation,
      classification: contactClassification,
      confidence
    },
    systemAudio: {
      ...systemAudioDetails,
      barrier: systemAudioDetails.detected,
      shouldTrackRecovery: systemAudioDetails.detected && systemAudioDetails.subtype !== "machine_voicemail"
    },
    opportunity: {
      positiveInterest,
      requestedCallback: callback,
      longTermDeferral,
      requestedEmailOrSms: emailOrSms,
      requestedQuote: quote,
      appointmentOrMeeting: appointment,
      followUpRequired,
      followUpChannel,
      confidence
    },
    risk: {
      complaint,
      optOut,
      reviewRequired: complaint || optOut,
      severity: optOut || complaint ? "high" : "none",
      confidence: complaint || optOut ? confidence : 0
    },
    outcome: {
      localCategory: localOutcomeCategory,
      reviewRequired,
      confidence
    },
    coaching: {
      missedFollowUpOpportunity: meaningfulConversation && positiveInterest && !followUpRequired,
      lowCustomerEngagement: probableLiveHuman && words < 35,
      confidence
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
