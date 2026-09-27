import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useAuth() {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });

  const login = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return {
    email: me.data?.email,
    isAuthenticated: me.isSuccess,
    isLoading: me.isLoading,
    login,
    logout,
  };
}
