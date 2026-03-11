import { PedagogicalRule, RuleTemplate, RuleSeverity, TimeTableEntry, SchoolConfig, SubjectCategory } from '../types.ts';

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  message: string;
  affectedEntryIds: string[];
}

export class ValidatorService {
  /**
   * Validates a proposed move against pedagogical rules.
   */
  static validateMove(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const rules = config.pedagogicalRules?.filter(r => r.isActive) || [];
    
    // Get section to identify the wing
    const section = config.sections.find(s => s.id === entry.sectionId);
    if (!section) return [];
    
    // Filter rules that apply to this wing
    const activeRules = rules.filter(r => r.targetWingIds.includes(section.wingId));
    
    for (const rule of activeRules) {
      switch (rule.template) {
        case RuleTemplate.ADJACENCY_RESTRICTION:
          const adjacencyViolations = this.checkAdjacency(timetable, entry, targetSlotId, targetDay, rule, config);
          violations.push(...adjacencyViolations);
          break;
        // Future templates can be added here
      }
    }
    
    return violations;
  }

  /**
   * Checks for adjacency violations (back-to-back restrictions).
   */
  private static checkAdjacency(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    rule: PedagogicalRule,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { primaryType, secondaryType, allowIfSame, forbiddenIfDifferent } = rule.config;
    
    // Check previous and next slots
    const neighbors = [targetSlotId - 1, targetSlotId + 1];
    
    for (const neighborSlotId of neighbors) {
      if (neighborSlotId < 1) continue;
      
      // Find the entry in the neighbor slot for the same section
      const neighborEntry = timetable[targetDay]?.find(p => 
        p.slotId === neighborSlotId && p.sectionId === entry.sectionId
      );
      
      if (!neighborEntry) continue;
      
      // Check if both entries match the types defined in the rule
      const isPrimaryMatch = this.isTypeMatch(entry, primaryType, config);
      const isSecondaryMatch = this.isTypeMatch(neighborEntry, secondaryType, config);
      
      // Adjacency rules are often symmetric, but we check both directions
      const isReverseMatch = this.isTypeMatch(entry, secondaryType, config) && 
                            this.isTypeMatch(neighborEntry, primaryType, config);

      if (isPrimaryMatch && isSecondaryMatch || isReverseMatch) {
        const isSameSubject = entry.subject === neighborEntry.subject;
        
        // Rule: Forbidden if different subjects (e.g., PE followed by Music)
        if (forbiddenIfDifferent && !isSameSubject) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Rule "${rule.name}" violated: ${entry.subject} and ${neighborEntry.subject} cannot be back-to-back.`,
            affectedEntryIds: [entry.id, neighborEntry.id]
          });
        }
        
        // Rule: Allow if same subject (e.g., Double Period of PE is okay, but not two different ones)
        // If allowIfSame is false, then even same subjects are forbidden back-to-back
        if (allowIfSame === false && isSameSubject) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: `Rule "${rule.name}" violated: Back-to-back ${entry.subject} is not allowed.`,
            affectedEntryIds: [entry.id, neighborEntry.id]
          });
        }
      }
    }
    
    return violations;
  }

  /**
   * Helper to check if an entry matches a specific type (Group Period, Lab, etc.)
   */
  private static isTypeMatch(entry: TimeTableEntry, type: string | undefined, config: SchoolConfig): boolean {
    if (!type) return false;
    
    if (type === 'GROUP_PERIOD') {
      return entry.subjectCategory === SubjectCategory.GROUP_PERIOD;
    }
    
    if (type === 'LAB_PERIOD') {
      return entry.subjectCategory === SubjectCategory.LAB_PERIOD;
    }
    
    if (type === 'EXTRA_CURRICULAR') {
      return entry.subjectCategory === SubjectCategory.EXTRA_CURRICULAR;
    }
    
    if (type === 'SUBJECT') {
      // This would require a subjectId in the config, which we can add later
      return false;
    }
    
    return false;
  }

  /**
   * Validates an entire timetable and returns all violations.
   */
  static validateTimetable(
    timetable: Record<string, TimeTableEntry[]>,
    config: SchoolConfig
  ): RuleViolation[] {
    const allViolations: RuleViolation[] = [];
    const processedPairs = new Set<string>();

    Object.entries(timetable).forEach(([day, entries]) => {
      entries.forEach(entry => {
        const violations = this.validateMove(timetable, entry, entry.slotId, day, config);
        violations.forEach(v => {
          // Sort IDs to avoid duplicate violations for the same pair
          const pairKey = v.affectedEntryIds.sort().join('|');
          if (!processedPairs.has(pairKey)) {
            allViolations.push(v);
            processedPairs.add(pairKey);
          }
        });
      });
    });

    return allViolations;
  }
}
