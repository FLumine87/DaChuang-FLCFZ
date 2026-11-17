import { createContext, useContext } from 'react';

/** 页面隐藏时保留任务，但停止只应在前台发生的交互。 */
export const PageActivityContext = createContext(true);
export const usePageActive = () => useContext(PageActivityContext);
