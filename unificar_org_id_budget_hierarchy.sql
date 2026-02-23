-- Orden correcto para unificar org_id en la jerarquía budgets > budget_lines > budget_line_materials
-- Nuevo org_id: 26900cad-0091-462a-924c-051a31e35067
-- Viejos org_id:
-- 492e8907-25c7-471b-a494-a908dd0dcc80
-- 5c5892c1-9884-4222-b982-9995a5107d02
-- 5c8a9817-6d02-4817-a2b4-1c30d7b4e559
-- 5e69fc3d-7975-4e65-8c4b-ba442d8925bd

-- Para org_id: 492e8907-25c7-471b-a494-a908dd0dcc80
UPDATE budget_line_materials SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '492e8907-25c7-471b-a494-a908dd0dcc80';
UPDATE budget_lines SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '492e8907-25c7-471b-a494-a908dd0dcc80';
UPDATE budgets SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '492e8907-25c7-471b-a494-a908dd0dcc80';

-- Para org_id: 5c5892c1-9884-4222-b982-9995a5107d02
UPDATE budget_line_materials SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c5892c1-9884-4222-b982-9995a5107d02';
UPDATE budget_lines SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c5892c1-9884-4222-b982-9995a5107d02';
UPDATE budgets SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c5892c1-9884-4222-b982-9995a5107d02';

-- Para org_id: 5c8a9817-6d02-4817-a2b4-1c30d7b4e559
UPDATE budget_line_materials SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c8a9817-6d02-4817-a2b4-1c30d7b4e559';
UPDATE budget_lines SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c8a9817-6d02-4817-a2b4-1c30d7b4e559';
UPDATE budgets SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5c8a9817-6d02-4817-a2b4-1c30d7b4e559';

-- Para org_id: 5e69fc3d-7975-4e65-8c4b-ba442d8925bd
UPDATE budget_line_materials SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5e69fc3d-7975-4e65-8c4b-ba442d8925bd';
UPDATE budget_lines SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5e69fc3d-7975-4e65-8c4b-ba442d8925bd';
UPDATE budgets SET org_id = '26900cad-0091-462a-924c-051a31e35067' WHERE org_id = '5e69fc3d-7975-4e65-8c4b-ba442d8925bd';
