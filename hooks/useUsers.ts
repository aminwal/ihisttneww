
import { useState, useCallback } from 'react';
import { User } from '../types.ts';
import { INITIAL_USERS } from '../constants.ts';

export const useUsers = (isSandbox: boolean) => {
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('ihis_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });
  const [sUsers, setSUsers] = useState<User[]>([]);

  const dUsers = isSandbox ? sUsers : users;
  const setDUsers = isSandbox ? setSUsers : setUsers;

  const enterSandbox = useCallback((liveUsers: User[]) => {
    setSUsers([...liveUsers]);
  }, []);

  return {
    users: dUsers,
    setUsers: setDUsers,
    liveUsers: users,
    setLiveUsers: setUsers,
    enterSandbox
  };
};
