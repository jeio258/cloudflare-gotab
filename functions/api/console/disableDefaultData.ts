import { snapshotWrite } from '../../lib/console';

export const onRequestPost = snapshotWrite('update default_data_history set enabled = 0 where id = ?', '已停用');
