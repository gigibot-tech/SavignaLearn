import { describe, expect, it } from 'vitest';
import {
  foldWhatsAppName,
  guessPartner,
  guessSelfSpeaker,
  parseWhatsAppTranscript,
  partnerCandidatesFromFriends,
  whatsappNameSimilarity,
} from './whatsappImport';

const SAMPLE = `[16:05, 3.9.2026] Andrea: Video
where tf she spawn from

actually filling out a slaydex omg
[16:06, 3.9.2026] Andrea: whats it name

i see the book on the table xD
[16:12, 3.9.2026] Savi(g)na 🔥: where tf she spawn from

actually filling out a slaydex omg
From tedi
[16:12, 3.9.2026] Savi(g)na 🔥: whats it name

i see the book on the table xD
She doesn’t have one yet
[16:14, 3.9.2026] Andrea: From tedi
o
m
g

she looks so much better/premium than from Tedi
[16:14, 3.9.2026] Andrea: how much
[16:14, 3.9.2026] Andrea: She doesn’t have one yet
u should ask her
[16:14, 3.9.2026] Andrea: idk how old she is though
[16:14, 3.9.2026] Savi(g)na 🔥: how much
15€
[16:15, 3.9.2026] Savi(g)na 🔥: u should ask her
Her name is lila
[16:15, 3.9.2026] Savi(g)na 🔥: Aber leila ausgesprochen
[16:15, 3.9.2026] Savi(g)na 🔥: idk how old she is though
Just born
[16:25, 3.9.2026] Andrea: omg aus nem ei geschlüpft? oder adoptiert

nicer Name. Spanisches Wasserpokemon einfach
[16:31, 3.9.2026] Savi(g)na 🔥: Ei
[16:31, 3.9.2026] Savi(g)na 🔥: Aus meinen Eiern
[16:33, 3.9.2026] Andrea: Hast du auch zwei?
[16:33, 3.9.2026] Andrea: jetzt aber nur eins
[16:33, 3.9.2026] Andrea: oder wiieee
[16:33, 3.9.2026] Andrea: bist du überhaupt ein homo sapiens
[16:34, 3.9.2026] Andrea: btw ich schicke dir morgen eine App / Webseite
[16:38, 3.9.2026] Savi(g)na 🔥: Hast du auch zwei?
Ja richtig dicke
[16:38, 3.9.2026] Savi(g)na 🔥: bist du überhaupt ein homo sapiens
Ja ich bin homo
[16:39, 3.9.2026] Savi(g)na 🔥: btw ich schicke dir morgen eine App / Webseite
Okay?
[16:39, 3.9.2026] Andrea: sapiens?

also ich dachte erstma auch du wärst homo

i mean jeder ist homo
[16:39, 3.9.2026] Andrea: homo sapiens sind homosexuell bei definition
[16:39, 3.9.2026] Andrea: Okay?
very ok
[16:39, 3.9.2026] Andrea: Ja richtig dicke
aber eins ist doch weg
[16:39, 3.9.2026] Savi(g)na 🔥: Ist nachgewachsen
[16:40, 3.9.2026] Andrea: ÜBER DIE NORM EHHHH
[16:40, 3.9.2026] Andrea: Ist nachgewachsen
oh krass
[16:40, 3.9.2026] Andrea: actually
[16:40, 3.9.2026] Andrea: Foto oder nie geschehen
[16:40, 3.9.2026] Andrea: glaube die wachsen nicht nach normalerweise
[16:40, 3.9.2026] Andrea: phänomenal
[16:40, 3.9.2026] Savi(g)na 🔥: Ich schick dir keine Fotos von meinen Eiern das ist privat
[16:40, 3.9.2026] Andrea: aber ein NACHGEWACHSENES
[16:40, 3.9.2026] Andrea: das crazy
[16:40, 3.9.2026] Savi(g)na 🔥: glaube die wachsen nicht nach normalerweise
Ja aber ich bin nicht normal
[16:41, 3.9.2026] Andrea: wissenschaftlich
[16:41, 3.9.2026] Andrea: interessant
[16:41, 3.9.2026] Andrea: Ja aber ich bin nicht normal
umso mehr
[16:43, 3.9.2026] Andrea: No te envío fotos de mis huevos, eso es privado.
[16:43, 3.9.2026] Andrea: sneak peak omg im so proud
`;

describe('whatsapp import parse', () => {
  it('parses German WhatsApp copy-paste headers and two speakers', () => {
    const parsed = parseWhatsAppTranscript(SAMPLE);
    expect(parsed.speakers.map((item) => item.name)).toEqual(['Andrea', 'Savi(g)na 🔥']);
    expect(parsed.messages[0]?.text).toContain('slaydex');
    expect(parsed.messages[0]?.createdAt.startsWith('2026-09-03T')).toBe(true);
  });

  it('strips quoted previous text so the reply is the new line', () => {
    const parsed = parseWhatsAppTranscript(SAMPLE);
    const fromTedi = parsed.messages.find(
      (item) => item.speaker.startsWith('Savi') && item.text.includes('From tedi')
    );
    expect(fromTedi?.text.trim()).toBe('From tedi');
    expect(fromTedi?.replyToIndex).not.toBeNull();

    const fifteen = parsed.messages.find((item) => item.text.includes('15€'));
    expect(fifteen?.text.trim()).toBe('15€');
  });

  it('folds Savi(g)na to savigna and matches email/username substrings', () => {
    expect(foldWhatsAppName('Savi(g)na 🔥')).toBe('savigna');
    expect(whatsappNameSimilarity('Andrea', 'andrearachetta')).toBeGreaterThan(0.8);
    expect(whatsappNameSimilarity('Savi(g)na 🔥', 'savigna')).toBeGreaterThan(0.9);
  });

  it('guesses Andrea as self from an andrearachetta email', () => {
    const parsed = parseWhatsAppTranscript(SAMPLE);
    const guess = guessSelfSpeaker(
      parsed.speakers.map((item) => item.name),
      { email: 'andrearachetta@gmail.com', username: 'andrea' }
    );
    expect(guess.speaker).toBe('Andrea');
    expect(guess.unsure).toBe(false);
  });

  it('guesses Savi(g)na as the partner named Savigna', () => {
    const guess = guessPartner('Savi(g)na 🔥', [
      { id: 'mira', username: 'mira', displayName: 'Mira', email: 'mira@savigna.local' },
      { id: 'sav', username: 'savigna', displayName: 'Savigna', email: 'savigna@savigna.local' },
    ]);
    expect(guess.partnerId).toBe('sav');
    expect(guess.unsure).toBe(false);
  });

  it('finds the partner among friend rows, which are keyed by userId', () => {
    const friends = [
      { userId: 'u-mira', username: 'mira', displayName: 'Mira', email: 'mira@savigna.local' },
      { userId: 'u-sav', username: 'savigna', displayName: 'Savigna', email: 'savigna@savigna.local' },
    ];
    const guess = guessPartner('Savi(g)na 🔥', partnerCandidatesFromFriends(friends));
    expect(guess.partnerId).toBe('u-sav');
  });

  it('marks the self guess unsure when names do not match', () => {
    const guess = guessSelfSpeaker(['Alex', 'Jordan'], {
      email: 'learner@savigna.local',
      username: 'learner',
    });
    expect(guess.unsure).toBe(true);
  });
});
