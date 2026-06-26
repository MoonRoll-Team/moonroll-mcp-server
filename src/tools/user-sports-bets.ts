import { getUserSportsActivity } from './user-sports-activity.js';

interface GetUserSportsBetsParams {
  userId: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

export async function getUserSportsBets(params: GetUserSportsBetsParams) {
  return getUserSportsActivity({
    ...params,
    include: 'summary,transactions,bets',
  });
}
