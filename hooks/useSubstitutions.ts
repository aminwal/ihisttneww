
import { useState, useCallback } from 'react';
import { SubstitutionRecord, DUMMY_SUBSTITUTIONS } from '../types.ts';

export const useSubstitutions = (isSandbox: boolean) => {
  const [substitutions, setSubstitutions] = useState<SubstitutionRecord[]>(DUMMY_SUBSTITUTIONS);
  const [sSubstitutions, setSSubstitutions] = useState<SubstitutionRecord[]>([]);

  const dSubstitutions = isSandbox ? sSubstitutions : substitutions;
  const setDSubstitutions = isSandbox ? setSSubstitutions : setSubstitutions;

  const enterSandbox = useCallback((liveSubstitutions: SubstitutionRecord[]) => {
    setSSubstitutions([...liveSubstitutions]);
  }, []);

  return {
    substitutions: dSubstitutions,
    setSubstitutions: setDSubstitutions,
    liveSubstitutions: substitutions,
    setLiveSubstitutions: setSubstitutions,
    enterSandbox
  };
};
