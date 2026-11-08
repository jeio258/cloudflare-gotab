import { snapshotWrite } from '../../lib/console';

export const onRequestPost = snapshotWrite('delete from default_data_history where id = ?', '已删除');
