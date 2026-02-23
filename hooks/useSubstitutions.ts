
import { useState, useCallback } from 'react';
import { SubstitutionRecord } from '../types.ts';
import { DUMMY_SUBSTITUTIONS } from '../constants.ts';

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
