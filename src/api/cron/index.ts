import { dailyPriceCheckJob } from "./jobs/dailyPriceCheckJob";


// Initialize all cron jobs
export const initCronJobs = () => {
    dailyPriceCheckJob();
};