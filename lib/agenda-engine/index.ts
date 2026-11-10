/**
 * Motor de regras da agenda do Legacy Meet. Puro e testável: sem React, sem
 * banco, sem relógio do sistema (o "agora" entra por parâmetro). Pode virar
 * pacote e ser usado por outros sistemas da Legacy.
 */
export * from './tempo';
export * from './feriados';
export * from './ciclo';
export * from './grupos';
export * from './recorrencia';
export * from './disponibilidade';
export * from './layout';
export * from './kpis';
