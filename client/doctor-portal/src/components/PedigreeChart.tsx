import React, { useMemo } from 'react';

// Standard pedigree symbols according to medical genetics conventions
// Squares = Male, Circles = Female, Diamonds = Unknown
// Filled = Affected, Half-filled = Carrier, Empty = Unaffected
// Diagonal line = Deceased

type RelationshipType =
  | 'mother'
  | 'father'
  | 'sister'
  | 'brother'
  | 'maternal-grandmother'
  | 'maternal-grandfather'
  | 'paternal-grandmother'
  | 'paternal-grandfather'
  | 'maternal-aunt'
  | 'maternal-uncle'
  | 'paternal-aunt'
  | 'paternal-uncle'
  | 'daughter'
  | 'son'
  | 'half-sister'
  | 'half-brother';

type VitalStatus = 'alive' | 'deceased' | 'unknown';

interface FamilyCondition {
  conditionName: string;
  category: string;
  ageOfOnset?: number;
  severity?: 'mild' | 'moderate' | 'severe';
  notes?: string;
}

interface FamilyMember {
  memberId: string;
  patientId: string;
  patientName: string;
  relationship: RelationshipType;
  name?: string;
  vitalStatus: VitalStatus;
  ageAtDeath?: number;
  causeOfDeath?: string;
  currentAge?: number;
  conditions: FamilyCondition[];
  consanguineous?: boolean;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
}

interface PedigreeNode {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'unknown';
  isProband: boolean;
  isAffected: boolean;
  isCarrier: boolean;
  isDeceased: boolean;
  age?: number;
  conditions: string[];
  generation: number;
  x: number;
  y: number;
}

interface PedigreeConnection {
  from: string;
  to: string;
  type: 'parent-child' | 'spouse' | 'sibling';
}

interface PedigreeChartProps {
  familyMembers: FamilyMember[];
  patientName: string;
  filterCondition?: string;
  className?: string;
}

const SYMBOL_SIZE = 40;
const GENERATION_HEIGHT = 120;
const HORIZONTAL_SPACING = 100;

// Determine gender from relationship
function getGenderFromRelationship(relationship: RelationshipType): 'male' | 'female' | 'unknown' {
  const maleRelations: RelationshipType[] = [
    'father', 'brother', 'maternal-grandfather', 'paternal-grandfather',
    'maternal-uncle', 'paternal-uncle', 'son', 'half-brother'
  ];
  const femaleRelations: RelationshipType[] = [
    'mother', 'sister', 'maternal-grandmother', 'paternal-grandmother',
    'maternal-aunt', 'paternal-aunt', 'daughter', 'half-sister'
  ];
  
  if (maleRelations.includes(relationship)) return 'male';
  if (femaleRelations.includes(relationship)) return 'female';
  return 'unknown';
}

// Determine generation level
function getGenerationFromRelationship(relationship: RelationshipType): number {
  // Generation 0 = proband (patient), -1 = parents, -2 = grandparents, 1 = children
  const generationMap: Record<RelationshipType, number> = {
    'maternal-grandmother': -2,
    'maternal-grandfather': -2,
    'paternal-grandmother': -2,
    'paternal-grandfather': -2,
    'mother': -1,
    'father': -1,
    'maternal-aunt': -1,
    'maternal-uncle': -1,
    'paternal-aunt': -1,
    'paternal-uncle': -1,
    'sister': 0,
    'brother': 0,
    'half-sister': 0,
    'half-brother': 0,
    'daughter': 1,
    'son': 1,
  };
  return generationMap[relationship] ?? 0;
}

// Symbol components
const MaleSymbol: React.FC<{
  x: number;
  y: number;
  isAffected: boolean;
  isCarrier: boolean;
  isDeceased: boolean;
  isProband: boolean;
  size: number;
}> = ({ x, y, isAffected, isCarrier, isDeceased, isProband, size }) => (
  <g>
    <rect
      x={x - size/2}
      y={y - size/2}
      width={size}
      height={size}
      fill={isAffected ? '#1e40af' : isCarrier ? 'url(#halfFill)' : 'white'}
      stroke={isProband ? '#dc2626' : '#374151'}
      strokeWidth={isProband ? 3 : 2}
    />
    {isDeceased && (
      <line
        x1={x - size/2 - 5}
        y1={y + size/2 + 5}
        x2={x + size/2 + 5}
        y2={y - size/2 - 5}
        stroke="#374151"
        strokeWidth={2}
      />
    )}
  </g>
);

const FemaleSymbol: React.FC<{
  x: number;
  y: number;
  isAffected: boolean;
  isCarrier: boolean;
  isDeceased: boolean;
  isProband: boolean;
  size: number;
}> = ({ x, y, isAffected, isCarrier, isDeceased, isProband, size }) => (
  <g>
    <circle
      cx={x}
      cy={y}
      r={size/2}
      fill={isAffected ? '#1e40af' : isCarrier ? 'url(#halfFill)' : 'white'}
      stroke={isProband ? '#dc2626' : '#374151'}
      strokeWidth={isProband ? 3 : 2}
    />
    {isDeceased && (
      <line
        x1={x - size/2 - 5}
        y1={y + size/2 + 5}
        x2={x + size/2 + 5}
        y2={y - size/2 - 5}
        stroke="#374151"
        strokeWidth={2}
      />
    )}
  </g>
);

const UnknownSymbol: React.FC<{
  x: number;
  y: number;
  isAffected: boolean;
  isCarrier: boolean;
  isDeceased: boolean;
  isProband: boolean;
  size: number;
}> = ({ x, y, isAffected, isCarrier, isDeceased, isProband, size }) => {
  // Diamond shape for unknown gender
  const halfSize = size / 2;
  const points = `${x},${y - halfSize} ${x + halfSize},${y} ${x},${y + halfSize} ${x - halfSize},${y}`;
  
  return (
    <g>
      <polygon
        points={points}
        fill={isAffected ? '#1e40af' : isCarrier ? 'url(#halfFill)' : 'white'}
        stroke={isProband ? '#dc2626' : '#374151'}
        strokeWidth={isProband ? 3 : 2}
      />
      {isDeceased && (
        <line
          x1={x - halfSize - 5}
          y1={y + halfSize + 5}
          x2={x + halfSize + 5}
          y2={y - halfSize - 5}
          stroke="#374151"
          strokeWidth={2}
        />
      )}
    </g>
  );
};

const PedigreeChart: React.FC<PedigreeChartProps> = ({
  familyMembers,
  patientName,
  filterCondition,
  className = '',
}) => {
  // Build nodes from family members
  const { nodes, connections, dimensions } = useMemo(() => {
    const nodesList: PedigreeNode[] = [];
    const connectionsList: PedigreeConnection[] = [];
    
    // Add proband (patient)
    nodesList.push({
      id: 'proband',
      name: patientName,
      gender: 'unknown', // Could be determined from patient data
      isProband: true,
      isAffected: false,
      isCarrier: false,
      isDeceased: false,
      conditions: [],
      generation: 0,
      x: 0,
      y: 0,
    });
    
    // Add family members
    familyMembers.forEach((member, index) => {
      const hasConditions = member.conditions.length > 0;
      const matchesFilter = !filterCondition || 
        member.conditions.some(c => 
          c.conditionName.toLowerCase().includes(filterCondition.toLowerCase()) ||
          c.category.toLowerCase().includes(filterCondition.toLowerCase())
        );
      
      nodesList.push({
        id: member.memberId,
        name: member.name || member.relationship,
        gender: getGenderFromRelationship(member.relationship),
        isProband: false,
        isAffected: hasConditions && (matchesFilter || !filterCondition),
        isCarrier: false,
        isDeceased: member.vitalStatus === 'deceased',
        age: member.currentAge ?? member.ageAtDeath,
        conditions: member.conditions.map(c => c.conditionName),
        generation: getGenerationFromRelationship(member.relationship),
        x: 0,
        y: 0,
      });
      
      // Add connection to proband
      const relationship = member.relationship;
      if (['mother', 'father'].includes(relationship)) {
        connectionsList.push({
          from: member.memberId,
          to: 'proband',
          type: 'parent-child',
        });
      } else if (['sister', 'brother', 'half-sister', 'half-brother'].includes(relationship)) {
        connectionsList.push({
          from: 'proband',
          to: member.memberId,
          type: 'sibling',
        });
      } else if (['daughter', 'son'].includes(relationship)) {
        connectionsList.push({
          from: 'proband',
          to: member.memberId,
          type: 'parent-child',
        });
      }
    });
    
    // Group by generation
    const generations: Map<number, PedigreeNode[]> = new Map();
    nodesList.forEach(node => {
      const genNodes = generations.get(node.generation) || [];
      genNodes.push(node);
      generations.set(node.generation, genNodes);
    });
    
    // Calculate positions
    const sortedGenerations = Array.from(generations.keys()).sort((a, b) => a - b);
    const minGeneration = Math.min(...sortedGenerations);
    
    let maxWidth = 0;
    sortedGenerations.forEach(gen => {
      const genNodes = generations.get(gen) || [];
      const genWidth = genNodes.length * HORIZONTAL_SPACING;
      maxWidth = Math.max(maxWidth, genWidth);
    });
    
    // Position nodes
    sortedGenerations.forEach(gen => {
      const genNodes = generations.get(gen) || [];
      const yPos = (gen - minGeneration) * GENERATION_HEIGHT + 60;
      const startX = (maxWidth - (genNodes.length - 1) * HORIZONTAL_SPACING) / 2 + 50;
      
      genNodes.forEach((node, idx) => {
        node.x = startX + idx * HORIZONTAL_SPACING;
        node.y = yPos;
      });
    });
    
    return {
      nodes: nodesList,
      connections: connectionsList,
      dimensions: {
        width: Math.max(maxWidth + 100, 400),
        height: sortedGenerations.length * GENERATION_HEIGHT + 100,
      },
    };
  }, [familyMembers, patientName, filterCondition]);

  if (familyMembers.length === 0) {
    return (
      <div className={`bg-gray-50 border border-gray-200 rounded-lg p-8 text-center ${className}`}>
        <p className="text-gray-600">No family members recorded. Add family history to generate pedigree chart.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg ${className}`}>
      <svg
        width="100%"
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="min-h-[300px]"
      >
        {/* Definitions for patterns */}
        <defs>
          <pattern id="halfFill" patternUnits="objectBoundingBox" width="1" height="1">
            <rect x="0" y="0" width="50%" height="100%" fill="#1e40af" />
            <rect x="50%" y="0" width="50%" height="100%" fill="white" />
          </pattern>
        </defs>
        
        {/* Draw connections first (behind symbols) */}
        {connections.map((conn, idx) => {
          const fromNode = nodes.find(n => n.id === conn.from);
          const toNode = nodes.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return null;
          
          if (conn.type === 'parent-child') {
            // Vertical line from parent down, then horizontal, then down to child
            const midY = (fromNode.y + toNode.y) / 2;
            return (
              <g key={idx}>
                <line
                  x1={fromNode.x}
                  y1={fromNode.y + SYMBOL_SIZE / 2}
                  x2={fromNode.x}
                  y2={midY}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
                <line
                  x1={fromNode.x}
                  y1={midY}
                  x2={toNode.x}
                  y2={midY}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
                <line
                  x1={toNode.x}
                  y1={midY}
                  x2={toNode.x}
                  y2={toNode.y - SYMBOL_SIZE / 2}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
              </g>
            );
          } else if (conn.type === 'sibling') {
            // Horizontal line between siblings
            const lineY = Math.min(fromNode.y, toNode.y) - SYMBOL_SIZE / 2 - 10;
            return (
              <g key={idx}>
                <line
                  x1={fromNode.x}
                  y1={fromNode.y - SYMBOL_SIZE / 2}
                  x2={fromNode.x}
                  y2={lineY}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
                <line
                  x1={fromNode.x}
                  y1={lineY}
                  x2={toNode.x}
                  y2={lineY}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
                <line
                  x1={toNode.x}
                  y1={lineY}
                  x2={toNode.x}
                  y2={toNode.y - SYMBOL_SIZE / 2}
                  stroke="#9ca3af"
                  strokeWidth={2}
                />
              </g>
            );
          }
          return null;
        })}
        
        {/* Draw symbols */}
        {nodes.map(node => (
          <g key={node.id}>
            {node.gender === 'male' && (
              <MaleSymbol
                x={node.x}
                y={node.y}
                isAffected={node.isAffected}
                isCarrier={node.isCarrier}
                isDeceased={node.isDeceased}
                isProband={node.isProband}
                size={SYMBOL_SIZE}
              />
            )}
            {node.gender === 'female' && (
              <FemaleSymbol
                x={node.x}
                y={node.y}
                isAffected={node.isAffected}
                isCarrier={node.isCarrier}
                isDeceased={node.isDeceased}
                isProband={node.isProband}
                size={SYMBOL_SIZE}
              />
            )}
            {node.gender === 'unknown' && (
              <UnknownSymbol
                x={node.x}
                y={node.y}
                isAffected={node.isAffected}
                isCarrier={node.isCarrier}
                isDeceased={node.isDeceased}
                isProband={node.isProband}
                size={SYMBOL_SIZE}
              />
            )}
            
            {/* Name label */}
            <text
              x={node.x}
              y={node.y + SYMBOL_SIZE / 2 + 15}
              textAnchor="middle"
              className="text-xs fill-gray-700 font-medium"
            >
              {node.name}
            </text>
            
            {/* Age label */}
            {node.age && (
              <text
                x={node.x}
                y={node.y + SYMBOL_SIZE / 2 + 28}
                textAnchor="middle"
                className="text-xs fill-gray-500"
              >
                {node.isDeceased ? `d.${node.age}` : `${node.age}y`}
              </text>
            )}
            
            {/* Conditions indicator */}
            {node.conditions.length > 0 && (
              <title>{node.conditions.join(', ')}</title>
            )}
          </g>
        ))}
      </svg>
      
      {/* Legend */}
      <div className="border-t border-gray-200 p-4 mt-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Legend</h4>
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" fill="white" stroke="#374151" strokeWidth="2" />
            </svg>
            <span className="text-gray-600">Male</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="white" stroke="#374151" strokeWidth="2" />
            </svg>
            <span className="text-gray-600">Female</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <polygon points="12,2 22,12 12,22 2,12" fill="white" stroke="#374151" strokeWidth="2" />
            </svg>
            <span className="text-gray-600">Unknown</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="#1e40af" stroke="#374151" strokeWidth="2" />
            </svg>
            <span className="text-gray-600">Affected</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="white" stroke="#dc2626" strokeWidth="3" />
            </svg>
            <span className="text-gray-600">Proband (Patient)</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="white" stroke="#374151" strokeWidth="2" />
              <line x1="0" y1="24" x2="24" y2="0" stroke="#374151" strokeWidth="2" />
            </svg>
            <span className="text-gray-600">Deceased</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PedigreeChart;
