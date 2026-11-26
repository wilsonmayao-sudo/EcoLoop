export interface FleetRegistryPermissions {
  canViewFleet: boolean;
  canManageFleet: boolean;
  canAddTruck: boolean;
  canEditTruck: boolean;
  canUpdateTruckStatus: boolean;
  canAssignDriver: boolean;
  canDeleteTruck: boolean;
  canManageMaintenance: boolean;
  canDispatchOverflow: boolean;
}

/**
 * Resolve Fleet Registry and dispatch operational capabilities by authenticated role.
 * Dispatchers can view the fleet registry, assign/change drivers on trucks, and
 * perform overflow dispatch operations, while Administrators retain exclusive
 * control over adding, editing, deactivating, deleting, or maintaining trucks.
 */
export function getFleetRegistryPermissions(role?: string | null): FleetRegistryPermissions {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  const isAdmin = normalized === "admin";
  const isDispatcher = normalized === "dispatcher";
  const isSupervisor = normalized === "supervisor";

  return {
    canViewFleet: isAdmin || isDispatcher || isSupervisor,
    canManageFleet: isAdmin,
    canAddTruck: isAdmin,
    canEditTruck: isAdmin,
    canUpdateTruckStatus: isAdmin,
    canAssignDriver: isAdmin || isDispatcher,
    canDeleteTruck: isAdmin,
    canManageMaintenance: isAdmin,
    canDispatchOverflow: isAdmin || isDispatcher,
  };
}
