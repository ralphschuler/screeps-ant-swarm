/**
 * Lab Manager - Stub for roles package
 * 
 * Provides interface for lab management.
 * Full implementation should be provided by consuming application.
 */

interface LabResourceNeed {
  labId: Id<StructureLab>;
  resourceType: ResourceConstant;
  amount: number;
  priority: number;
}

export const labManager = {
  getLabResourceNeeds: (roomName: string): LabResourceNeed[] => {
    return [];
  },
  getLabSupplyNeeds: (roomName: string): LabResourceNeed[] => {
    return [];
  },
  getLabOverflow: (roomName: string): LabResourceNeed[] => {
    return [];
  }
};
