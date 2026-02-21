
import { useState, useCallback } from 'react';
import { SchoolConfig } from '../types.ts';
import { INITIAL_CONFIG } from '../constants.ts';

export const useSchoolConfig = (isSandbox: boolean) => {
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>(INITIAL_CONFIG);
  const [sSchoolConfig, setSSchoolConfig] = useState<SchoolConfig>(INITIAL_CONFIG);

  const dSchoolConfig = isSandbox ? sSchoolConfig : schoolConfig;
  const setDSchoolConfig = isSandbox ? setSSchoolConfig : setSchoolConfig;

  const enterSandbox = useCallback((liveConfig: SchoolConfig) => {
    setSSchoolConfig({ ...liveConfig });
  }, []);

  return {
    schoolConfig: dSchoolConfig,
    setSchoolConfig: setDSchoolConfig,
    liveSchoolConfig: schoolConfig,
    setLiveSchoolConfig: setSchoolConfig,
    enterSandbox
  };
};
