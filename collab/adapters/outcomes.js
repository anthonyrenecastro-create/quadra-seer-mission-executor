// Outcomes adapter: pure mapping from an experiment result to a normalized
// learning-event record. Mirrors the SHAPE of event_normalization.py's
// normalize_learning_event_payload (event + event_data envelope) WITHOUT
// importing torch and WITHOUT touching hot memory. No side effects.
// `match` is taken from the human-recorded result.matchedPrediction only —
// never inferred. null means "not assessed".

export function resultToLearningEvent(experiment, result) {
  const exp = experiment || {};
  const res = result || {};
  const prediction = typeof exp.prediction === 'string' ? exp.prediction.trim() : '';
  const observations = typeof res.observations === 'string' ? res.observations.trim() : '';
  const match =
    typeof res.matchedPrediction === 'boolean' ? res.matchedPrediction : null;

  return {
    event: 'experiment_outcome',
    event_data: {
      experimentId: exp.id || null,
      missionId: exp.missionId || null,
      branchId: exp.branchId || null,
      title: exp.title || '',
      kind: res.kind || exp.kind || 'planned-test',
      prediction,
      outcome: observations,
      measurements: Array.isArray(res.measurements) ? res.measurements : [],
      match,
      resultVersion: typeof res.v === 'number' ? res.v : null,
      successCriteria: exp.successCriteria || '',
    },
    recordedAt: new Date().toISOString(),
  };
}
