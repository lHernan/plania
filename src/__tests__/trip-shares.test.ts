import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del servidor de Supabase y funciones de Next.js
vi.mock("@/lib/supabase-server", () => ({
  getServerSupabase: vi.fn(),
  getServiceRoleSupabase: vi.fn(),
}));

// Importar rutas a testear (usaremos los Route Handlers directamente)
// Como son Server Modules, requerirían entorno Node, pero Vitest puede ejecutarlos si mockeamos Request y NextResponse.
import { POST as ShareTripPOST } from "@/app/api/trips/[tripId]/share/route";
import { GET as ShareTripGET } from "@/app/api/trips/[tripId]/shares/route";
import { DELETE as ShareTripDELETE } from "@/app/api/trips/[tripId]/shares/[userId]/route";

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase-server";

describe("Viajes Compartidos API", () => {
  const mockUser = { id: "user-123", email: "propietario@test.com" };
  const mockInvitee = { id: "user-456", email: "invitado@test.com" };
  const mockTrip = { id: "trip-123", user_id: "user-123", name: "Viaje a París" };

  let mockSupabaseClient: any;
  let mockAdminClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockTrip, error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [{ shared_with: mockInvitee.id, created_at: "2024-01-01" }], error: null }),
      }),
    };

    mockAdminClient = {
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [mockUser, mockInvitee] },
            error: null,
          }),
        },
      },
    };

    (getServerSupabase as any).mockResolvedValue(mockSupabaseClient);
    (getServiceRoleSupabase as any).mockReturnValue(mockAdminClient);
  });

  describe("POST /api/trips/[tripId]/share", () => {
    it("debe compartir un viaje correctamente con un usuario existente", async () => {
      const request = new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ email: mockInvitee.email }),
      });

      const response = await ShareTripPOST(request, { params: Promise.resolve({ tripId: mockTrip.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.sharedWithEmail).toBe(mockInvitee.email);
    });

    it("debe retornar 404 si el usuario no existe", async () => {
      const request = new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ email: "noexiste@test.com" }),
      });

      const response = await ShareTripPOST(request, { params: Promise.resolve({ tripId: mockTrip.id }) });
      expect(response.status).toBe(404);
    });

    it("debe retornar 400 si se intenta compartir con uno mismo", async () => {
      const request = new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ email: mockUser.email }),
      });

      const response = await ShareTripPOST(request, { params: Promise.resolve({ tripId: mockTrip.id }) });
      expect(response.status).toBe(400);
    });

    it("debe retornar 403 si un invitado intenta compartir", async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: mockInvitee }, error: null });

      const request = new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ email: "otro@test.com" }),
      });

      const response = await ShareTripPOST(request, { params: Promise.resolve({ tripId: mockTrip.id }) });
      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/trips/[tripId]/shares", () => {
    it("debe retornar la lista de invitados para el propietario", async () => {
      const request = new Request("http://localhost/api", { method: "GET" });
      const response = await ShareTripGET(request, { params: Promise.resolve({ tripId: mockTrip.id }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.shares).toHaveLength(1);
      expect(data.shares[0].email).toBe(mockInvitee.email);
    });
  });

  describe("DELETE /api/trips/[tripId]/shares/[userId]", () => {
    it("debe revocar el acceso de un invitado", async () => {
      mockSupabaseClient.from().delete.mockResolvedValue({ error: null });
      
      const request = new Request("http://localhost/api", { method: "DELETE" });
      const response = await ShareTripDELETE(request, { 
        params: Promise.resolve({ tripId: mockTrip.id, userId: mockInvitee.id }) 
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
