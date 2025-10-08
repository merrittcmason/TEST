import { createContext, useContext } from 'react';

const UserSettingsContext = createContext<{ timezone: string }>({ timezone: 'UTC' });

export const useUserSettings = () => useContext(UserSettingsContext);
export { UserSettingsContext };
