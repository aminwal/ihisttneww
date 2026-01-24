
export const getBahrainTime = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bahrain" }));

export const formatBahrainDate = (date: Date = getBahrainTime()) => {
  return new Intl.DateTimeFormat('en-CA', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  }).format(date);
};

export const formatBahrainTime = (date: Date = getBahrainTime()) => {
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
  });
};

export const validateTimeInput = (timeStr: string): boolean => {
  const regex = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s(AM|PM)$/i;
  return regex.test(timeStr);
};

export const getWeekDates = (baseDate: string = formatBahrainDate()) => {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0 (Sun) to 6 (Sat)
  
  const sun = new Date(d);
  sun.setDate(d.getDate() - day);
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
  const map: Record<string, string> = {};
  
  days.forEach((dayName, index) => {
    const current = new Date(sun);
    current.setDate(sun.getDate() + index);
    map[dayName] = current.toISOString().split('T')[0];
  });
  
  return map;
};
