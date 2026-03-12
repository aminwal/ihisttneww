import { PedagogicalRule, RuleTemplate, RuleSeverity, TimeTableEntry, SchoolConfig, SubjectCategory } from '../types';
import { DAYS } from '../constants';

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
        case RuleTemplate.BACK_TO_BACK_DAYS_RESTRICTION:
          const b2bViolations = this.checkBackToBackDays(timetable, entry, targetSlotId, targetDay, rule, config);
          violations.push(...b2bViolations);
          break;
        case RuleTemplate.CONSECUTIVE_LIMIT:
          const consecutiveViolations = this.checkConsecutiveLimit(timetable, entry, targetSlotId, targetDay, rule, config);
          violations.push(...consecutiveViolations);
          break;
        case RuleTemplate.DAILY_LIMIT:
          const dailyViolations = this.checkDailyLimit(timetable, entry, targetSlotId, targetDay, rule, config);
          violations.push(...dailyViolations);
          break;
        case RuleTemplate.SLOT_RESTRICTION:
          const slotViolations = this.checkSlotRestriction(timetable, entry, targetSlotId, targetDay, rule, config);
          violations.push(...slotViolations);
          break;
      }
    }
    
    return violations;
  }

  /**
   * Checks for daily limit violations.
   */
  private static checkDailyLimit(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    rule: PedagogicalRule,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const primaryTypes = rule.config.primaryTypes || (rule.config.primaryType ? [rule.config.primaryType] : undefined);
    const subjectIds = rule.config.subjectIds || (rule.config.subjectId ? [rule.config.subjectId] : undefined);
    const { maxCount } = rule.config;
    if (!maxCount) return [];

    if (!this.isTypeMatch(entry, primaryTypes, subjectIds, config)) return [];

    const dayEntries = timetable[targetDay] || [];
    const matchCount = dayEntries.filter(e => 
      e.id !== entry.id && 
      e.sectionId === entry.sectionId && 
      this.isTypeMatch(e, primaryTypes, subjectIds, config)
    ).length + 1;

    if (matchCount > maxCount) {
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: `Rule "${rule.name}" violated: ${entry.subject} exceeds the daily limit of ${maxCount} for this section.`,
        affectedEntryIds: [entry.id]
      });
    }

    return violations;
  }

  /**
   * Checks for slot restriction violations.
   */
  private static checkSlotRestriction(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    rule: PedagogicalRule,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const primaryTypes = rule.config.primaryTypes || (rule.config.primaryType ? [rule.config.primaryType] : undefined);
    const subjectIds = rule.config.subjectIds || (rule.config.subjectId ? [rule.config.subjectId] : undefined);
    const { allowedSlots } = rule.config;
    if (!allowedSlots || allowedSlots.length === 0) return [];

    if (!this.isTypeMatch(entry, primaryTypes, subjectIds, config)) return [];

    if (!allowedSlots.includes(targetSlotId)) {
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: `Rule "${rule.name}" violated: ${entry.subject} is not allowed in slot ${targetSlotId}. Allowed slots: ${allowedSlots.join(', ')}.`,
        affectedEntryIds: [entry.id]
      });
    }

    return violations;
  }

  /**
   * Checks for back-to-back days violations.
   */
  private static checkBackToBackDays(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    rule: PedagogicalRule,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const primaryTypes = rule.config.primaryTypes || (rule.config.primaryType ? [rule.config.primaryType] : undefined);
    const subjectIds = rule.config.subjectIds || (rule.config.subjectId ? [rule.config.subjectId] : undefined);
    
    if (!this.isTypeMatch(entry, primaryTypes, subjectIds, config)) return [];
    
    const currentDayIndex = DAYS.indexOf(targetDay);
    if (currentDayIndex === -1) return [];
    
    const adjacentDayIndices = [currentDayIndex - 1, currentDayIndex + 1];
    
    for (const dayIndex of adjacentDayIndices) {
      if (dayIndex < 0 || dayIndex >= DAYS.length) continue;
      
      const neighborDay = DAYS[dayIndex];
      const neighborEntries = timetable[neighborDay] || [];
      
      // Check if the same subject/type exists on the adjacent day for the same section
      const violationEntry = neighborEntries.find(e => 
        e.sectionId === entry.sectionId && 
        this.isTypeMatch(e, primaryTypes, subjectIds, config)
      );
      
      if (violationEntry) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Rule "${rule.name}" violated: ${entry.subject} cannot be assigned on back-to-back days (${targetDay} and ${neighborDay}).`,
          affectedEntryIds: [entry.id, violationEntry.id]
        });
      }
    }
    
    return violations;
  }

  /**
   * Checks for consecutive periods limit violations for a teacher.
   */
  private static checkConsecutiveLimit(
    timetable: Record<string, TimeTableEntry[]>,
    entry: TimeTableEntry,
    targetSlotId: number,
    targetDay: string,
    rule: PedagogicalRule,
    config: SchoolConfig
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const primaryTypes = rule.config.primaryTypes || (rule.config.primaryType ? [rule.config.primaryType] : undefined);
    const subjectIds = rule.config.subjectIds || (rule.config.subjectId ? [rule.config.subjectId] : undefined);
    const { maxCount } = rule.config;
    if (!maxCount) return [];

    const dayEntries = timetable[targetDay] || [];
    // Include the proposed entry in the day's entries for checking
    const allEntries = [...dayEntries.filter(e => e.id !== entry.id), { ...entry, slotId: targetSlotId }];
    
    // We are checking for the teacher of the current entry
    // Filter by type if specified
    const teacherEntries = allEntries.filter(e => 
      e.teacherId === entry.teacherId && 
      this.isTypeMatch(e, primaryTypes, subjectIds, config)
    );
    
    // Sort by slotId
    teacherEntries.sort((a, b) => a.slotId - b.slotId);
    
    let consecutiveCount = 1;
    let currentSequence: string[] = [];

    if (teacherEntries.length > 0) {
      currentSequence = [teacherEntries[0].id];
      
      for (let i = 0; i < teacherEntries.length - 1; i++) {
        if (teacherEntries[i+1].slotId === teacherEntries[i].slotId + 1) {
          consecutiveCount++;
          currentSequence.push(teacherEntries[i+1].id);
        } else {
          if (consecutiveCount > maxCount && currentSequence.includes(entry.id)) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.name,
              severity: rule.severity,
              message: `Rule "${rule.name}" violated: ${entry.teacherName} has ${consecutiveCount} consecutive periods, exceeding the limit of ${maxCount}.`,
              affectedEntryIds: [...currentSequence]
            });
            return violations; // Found violation involving the entry
          }
          consecutiveCount = 1;
          currentSequence = [teacherEntries[i+1].id];
        }
      }
      
      // Check last sequence
      if (consecutiveCount > maxCount && currentSequence.includes(entry.id)) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Rule "${rule.name}" violated: ${entry.teacherName} has ${consecutiveCount} consecutive periods, exceeding the limit of ${maxCount}.`,
          affectedEntryIds: [...currentSequence]
        });
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
    const primaryTypes = rule.config.primaryTypes || (rule.config.primaryType ? [rule.config.primaryType] : undefined);
    const secondaryTypes = rule.config.secondaryTypes || (rule.config.secondaryType ? [rule.config.secondaryType] : undefined);
    const subjectIds = rule.config.subjectIds || (rule.config.subjectId ? [rule.config.subjectId] : undefined);
    const secondarySubjectIds = rule.config.secondarySubjectIds || (rule.config.secondarySubjectId ? [rule.config.secondarySubjectId] : undefined);
    const { allowIfSame, forbiddenIfDifferent } = rule.config;
    
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
      const isPrimaryMatch = this.isTypeMatch(entry, primaryTypes, subjectIds, config);
      const isSecondaryMatch = this.isTypeMatch(neighborEntry, secondaryTypes, secondarySubjectIds || subjectIds, config);
      
      // Adjacency rules are often symmetric, but we check both directions
      const isReverseMatch = this.isTypeMatch(entry, secondaryTypes, secondarySubjectIds || subjectIds, config) && 
                            this.isTypeMatch(neighborEntry, primaryTypes, subjectIds, config);

      if ((isPrimaryMatch && isSecondaryMatch) || isReverseMatch) {
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
  private static isTypeMatch(entry: TimeTableEntry, types: string[] | undefined, subjectIds: string[] | undefined, config: SchoolConfig): boolean {
    // If no filters specified, it's a match
    const hasTypeFilter = types && types.length > 0 && !types.includes('ALL_PERIODS');
    const hasSubjectFilter = subjectIds && subjectIds.length > 0;

    if (!hasTypeFilter && !hasSubjectFilter) return true;

    let typeMatch = !hasTypeFilter;
    if (hasTypeFilter && types) {
      typeMatch = types.some(type => {
        if (type === 'GROUP_PERIOD') return entry.subjectCategory === SubjectCategory.GROUP_PERIOD;
        if (type === 'LAB_PERIOD') return entry.subjectCategory === SubjectCategory.LAB_PERIOD;
        if (type === 'EXTRA_CURRICULAR') return entry.subjectCategory === SubjectCategory.EXTRA_CURRICULAR;
        return false;
      });
    }

    let subjectMatch = !hasSubjectFilter;
    if (hasSubjectFilter && subjectIds) {
      subjectMatch = subjectIds.some(id => {
        const subject = config.subjects.find(s => s.id === id);
        return subject ? entry.subject === subject.name : false;
      });
    }

    return typeMatch && subjectMatch;
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
