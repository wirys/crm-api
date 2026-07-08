const ADMIN_GROUPS = new Set([1, 2, 3, 5, 7]);

export function getUserContext(request: Request) {
    const userId = Number(request.headers.get("x-user-id") || 0);
    const userGroup = Number(request.headers.get("x-user-group") || 0);
    const isAdmin = ADMIN_GROUPS.has(userGroup);
    return { userId, userGroup, isAdmin };
}
