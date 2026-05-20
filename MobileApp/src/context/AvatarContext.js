import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AvatarContext = createContext();
const STORAGE_KEY = 'avatar-uri';

export const useAvatar = () => {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error('useAvatar must be used within AvatarProvider');
  return ctx;
};

export const AvatarProvider = ({ children }) => {
  const [avatarUri, setAvatarUri] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setAvatarUri(saved);
      } catch (e) {
        // Silent error handling - avatar will use default
      }
    })();
  }, []);

  const updateAvatar = async (uri) => {
    try {
      setAvatarUri(uri);
      if (uri) {
        await AsyncStorage.setItem(STORAGE_KEY, uri);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      // Silent error handling - avatar change may not persist
    }
  };

  return (
    <AvatarContext.Provider value={{ avatarUri, setAvatarUri: updateAvatar }}>
      {children}
    </AvatarContext.Provider>
  );
};

