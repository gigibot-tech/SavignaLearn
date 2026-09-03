import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createChatCompletion,
  createChatRepository,
  defaultAiBackend,
  defaultTokenizer,
  ensureLearningBotChat,
  envFourSomeUserId,
  loadAiBackend,
  loadFourSomeUserId,
  noOpWordTap,
  resolveFourSomeUserId,
  saveAiBackend,
  saveFourSomeUserId,
  type AiBackendId,
} from '@/adapters/chat';
import { createVocabularyCardPort, memoryLearningItems } from '@/adapters/vocabulary';
import { createFriendsRepository, usernameFromUser, memoryFriends } from '@/adapters/friends';
import {
  applyFourSomeSession,
  applyIdoSession,
  applyWebGemmaCheck,
  isBackendSelectable,
  preferredLiveBackend,
  type AiHealthReport,
} from '@/adapters/aiHealth';
import { getFourSomeEmail } from '@/adapters/fourSomeAuth';
import { getIdoEmail, probeIdoAssist } from '@/adapters/idoAi';
import { onWebGemmaStatus, probeWebGemma } from '@/adapters/webGemma';
import { createAuthPort } from '@/adapters/supabase';
import { chatActorIds, chatPersistenceUserId } from '@/adapters/identity';
import { authStorage } from '@/adapters/authStorage';
import {
  createTranslationEngine,
  InMemoryChatHistoryStore,
} from '@/adapters/translation';
import type {
  AuthPort,
  AuthUser,
  ChatCompletionPort,
  ChatHistoryStore,
  ChatRepository,
  FriendsRepository,
  TokenizerPort,
  TranslationEngine,
  VocabularyCardPort,
  WordTapPort,
  LearningItemRepository,
} from '@/ports/ports';

function buildServices(aiBackend: AiBackendId, fourSomeUserId: string | null) {
  const completion = createChatCompletion(aiBackend, { fourSomeUserId });
  const chat = createChatRepository();
  return {
    auth: createAuthPort(),
    chat,
    completion,
    translation: createTranslationEngine({ completion }),
    tokenizer: defaultTokenizer,
    wordTap: noOpWordTap,
    vocabularyCards: createVocabularyCardPort(completion),
    learningItems: memoryLearningItems,
    historyStore: new InMemoryChatHistoryStore(authStorage),
    friends: createFriendsRepository(),
  };
}

export interface AppServices {
  auth: AuthPort;
  chat: ChatRepository;
  translation: TranslationEngine;
  completion: ChatCompletionPort;
  tokenizer: TokenizerPort;
  wordTap: WordTapPort;
  vocabularyCards: VocabularyCardPort;
  learningItems: LearningItemRepository;
  historyStore: ChatHistoryStore;
  friends: FriendsRepository;
  aiBackend: AiBackendId;
  setAiBackend: (id: AiBackendId) => void;
  fourSomeUserId: string | null;
  setFourSomeUserId: (id: string) => void;
  health: AiHealthReport | null;
  healthChecking: boolean;
  refreshHealth: () => void;
  friendsTick: number;
  bumpFriends: () => void;
}

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  justSignedIn: boolean;
  markJustSignedIn: () => void;
  clearJustSignedIn: () => void;
};

const ServicesContext = createContext<AppServices | null>(null);
const AuthContext = createContext<AuthContextValue>({
  user: null,
  ready: false,
  justSignedIn: false,
  markJustSignedIn: () => {},
  clearJustSignedIn: () => {},
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [aiBackend, setAiBackendState] = useState<AiBackendId>(defaultAiBackend);
  const [fourSomeUserId, setFourSomeUserIdState] = useState<string | null>(envFourSomeUserId);
  const [core, setCore] = useState(() => buildServices(defaultAiBackend(), envFourSomeUserId()));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const markJustSignedIn = useCallback(() => setJustSignedIn(true), []);
  const clearJustSignedIn = useCallback(() => setJustSignedIn(false), []);
  const [health, setHealth] = useState<AiHealthReport | null>(null);
  const [healthChecking, setHealthChecking] = useState(true);
  const [friendsTick, setFriendsTick] = useState(0);
  const bumpFriends = useCallback(() => setFriendsTick((n) => n + 1), []);

  const rebuild = useCallback((backend: AiBackendId, userId: string | null) => {
    setCore((prev) => {
      const next = buildServices(backend, userId);
      return { ...next, auth: prev.auth, chat: prev.chat, historyStore: prev.historyStore, friends: prev.friends, learningItems: prev.learningItems };
    });
  }, []);

  const setAiBackend = useCallback(
    (id: AiBackendId) => {
      if (!isBackendSelectable(id, health)) return;
      setAiBackendState(id);
      void saveAiBackend(id);
      rebuild(id, fourSomeUserId);
    },
    [fourSomeUserId, health, rebuild]
  );

  const setFourSomeUserId = useCallback(
    (id: string) => {
      const uuid = resolveFourSomeUserId(id);
      if (!uuid) return;
      setFourSomeUserIdState(uuid);
      void saveFourSomeUserId(uuid);
      rebuild(aiBackend, uuid);
    },
    [aiBackend, rebuild]
  );

  const refreshHealth = useCallback(() => {
    setHealthChecking(true);
    void (async () => {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) {
          setHealth({
            checkedAt: new Date().toISOString(),
            checks: [
              { id: 'server', label: 'Server', ok: false, detail: `${response.status}` },
              { id: 'demo', label: 'Demo', ok: true, detail: 'offline scripted' },
            ],
          });
          return;
        }
        const report = (await response.json()) as AiHealthReport;
        const [idoSigned, fourSomeSigned] = await Promise.all([getIdoEmail(), getFourSomeEmail()]);
        let next = applyFourSomeSession(
          applyIdoSession(applyWebGemmaCheck(report, probeWebGemma()), Boolean(idoSigned)),
          Boolean(fourSomeSigned)
        );
        if (idoSigned) {
          const assist = await probeIdoAssist();
          next = {
            ...next,
            checks: next.checks.map((item) =>
              item.id === 'ido' ? { ...item, ok: assist.ok, detail: assist.detail } : item
            ),
          };
        }
        setHealth(next);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unreachable';
        setHealth({
          checkedAt: new Date().toISOString(),
          checks: [
            { id: 'server', label: 'Server', ok: false, detail },
            { id: 'demo', label: 'Demo', ok: true, detail: 'offline scripted' },
          ],
        });
      } finally {
        setHealthChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    refreshHealth();
  }, [ready, user?.fourSomeUserId, user?.idoUserId, refreshHealth]);

  useEffect(() => {
    if (!ready || !user) return;
    // Chat first-paint is local KV. Do not preload Transformers.js (Metro 500) on login.
    return onWebGemmaStatus(() => {
      setHealth((prev) => {
        if (!prev) return prev;
        return applyFourSomeSession(
          applyIdoSession(applyWebGemmaCheck(prev, probeWebGemma()), Boolean(user.idoUserId)),
          Boolean(user.fourSomeUserId)
        );
      });
    });
  }, [ready, user]);

  useEffect(() => {
    if (!health || healthChecking) return;
    const next = preferredLiveBackend(health.checks, aiBackend, {
      preferIdo: Boolean(user?.idoUserId),
    });
    if (next === aiBackend) return;
    setAiBackendState(next);
    void saveAiBackend(next);
    rebuild(next, fourSomeUserId);
  }, [aiBackend, fourSomeUserId, health, healthChecking, rebuild, user?.idoUserId]);

  useEffect(() => {
    void Promise.all([loadAiBackend(), loadFourSomeUserId()]).then(([storedBackend, storedUser]) => {
      setAiBackendState((currentBackend) => {
        setFourSomeUserIdState((currentUser) => {
          const nextUser = storedUser ?? currentUser;
          const nextBackend = storedBackend;
          if (nextBackend !== currentBackend || nextUser !== currentUser) {
            rebuild(nextBackend, nextUser);
          }
          return nextUser;
        });
        return storedBackend;
      });
    });
  }, [rebuild]);

  const services: AppServices = {
    ...core,
    aiBackend,
    setAiBackend,
    fourSomeUserId,
    setFourSomeUserId,
    health,
    healthChecking,
    refreshHealth,
    friendsTick,
    bumpFriends,
  };

  useEffect(() => {
    let mounted = true;
    void services.auth.getSession().then((session) => {
      if (mounted) {
        setUser(session);
        setReady(true);
      }
    });
    const unsub = services.auth.onAuthStateChange((next) => {
      if (mounted) {
        setUser(next);
        setReady(true);
      }
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [services.auth]);

  useEffect(() => {
    const uuid = resolveFourSomeUserId(user?.fourSomeUserId);
    if (!uuid || uuid === fourSomeUserId) return;
    setFourSomeUserIdState(uuid);
    void saveFourSomeUserId(uuid);
    rebuild(aiBackend, uuid);
  }, [user?.fourSomeUserId, fourSomeUserId, aiBackend, rebuild]);

  useEffect(() => {
    if (!user) return;
    const chatUserId = chatPersistenceUserId(user);
    const actorIds = chatActorIds(user);
    const chat = core.chat;
    void (async () => {
      await memoryFriends.registerProfile({
        id: user.id,
        username: usernameFromUser(user),
        displayName: user.displayName ?? usernameFromUser(user),
        email: user.email ?? '',
      });
      memoryFriends.seedForViewer(user.id, { id: user.id, email: user.email });
      const history = core.historyStore as { hydrateForUser?: (userId: string) => Promise<void> };
      if (typeof history.hydrateForUser === 'function') {
        for (const id of actorIds) {
          await history.hydrateForUser(id);
        }
      }
      await ensureLearningBotChat(chat, chatUserId, actorIds);
      bumpFriends();
    })();
  }, [user, bumpFriends, core.chat]);

  return (
    <ServicesContext.Provider value={services}>
      <AuthContext.Provider value={{ user, ready, justSignedIn, markJustSignedIn, clearJustSignedIn }}>
        {children}
      </AuthContext.Provider>
    </ServicesContext.Provider>
  );
}

export function useServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices requires AppProviders');
  return ctx;
}

export function useAuthState() {
  return useContext(AuthContext);
}
