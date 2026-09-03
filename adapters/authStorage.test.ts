import { describe, expect, it } from 'vitest';
import { DEMO_LEARNER_EMAIL, DEMO_LEARNER_PASSWORD, IDO_LEARN_EMAIL, IDO_LEARN_PASSWORD, IDO_SAVINA_EMAIL, isDemoLearnerCredentials } from './authStorage';

describe('local demo learner', () => {
  it('accepts learner@savigna.local with password demo', () => {
    expect(isDemoLearnerCredentials(DEMO_LEARNER_EMAIL, DEMO_LEARNER_PASSWORD)).toBe(true);
    expect(isDemoLearnerCredentials('  Learner@Savigna.local  ', 'demo')).toBe(true);
    expect(isDemoLearnerCredentials(DEMO_LEARNER_EMAIL, 'wrong')).toBe(false);
    expect(isDemoLearnerCredentials('someone@foursome.app', 'demo')).toBe(false);
  });

  it('accepts the iDO learn accounts with password learn', () => {
    expect(isDemoLearnerCredentials(IDO_LEARN_EMAIL, IDO_LEARN_PASSWORD)).toBe(true);
    expect(isDemoLearnerCredentials(IDO_SAVINA_EMAIL, IDO_LEARN_PASSWORD)).toBe(true);
    expect(isDemoLearnerCredentials(IDO_LEARN_EMAIL, 'demo')).toBe(true);
    expect(isDemoLearnerCredentials(IDO_SAVINA_EMAIL, 'demo')).toBe(false);
  });
});
